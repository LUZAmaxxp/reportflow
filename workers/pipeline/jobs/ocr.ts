import type { Job } from "bullmq";
import { workerDb } from "../db";
import { withTenant } from "@/lib/db/rls";
import { documentVersions } from "@/lib/db/schema/documents";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { pipelineRuns } from "@/lib/db/schema/pipeline";
import { r2Client, R2_BUCKET } from "@/lib/r2";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { convertToPageImages } from "@/lib/ocr/pdf2pic";
import { ocrPage } from "@/lib/ocr/paddleocr";
import { parseOCRResponse } from "@/lib/ocr/parse";
import { mergeAdjacentBlocks } from "@/lib/chunking/merge";
import { splitOversizedBlocks } from "@/lib/chunking/split";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { embeddingQueue } from "@/lib/queues";
import { eq, and } from "drizzle-orm";
import { incrementActiveJobs, decrementActiveJobs } from "../health";

interface OcrJobPayload {
  documentVersionId: string;
  companyId: string;
}

/**
 * OCR pipeline job implementing:
 * - Status gate idempotency
 * - Status transitions uploaded→ocr_processing→ocr_done
 * - R2 file fetch, pdf2pic conversion, per-page PaddleOCR
 * - Bbox normalization, chunking merge/split pipeline
 * - Bulk insert evidence blocks
 * - Page PNG upload to R2
 * - Event publishing and enqueue embedding-job
 *
 * Allows re-entry from ocr_processing and failed for crash recovery/retry endpoint.
 */
export async function processOcrJob(job: Job<OcrJobPayload>): Promise<void> {
  const { documentVersionId, companyId } = job.data;
  incrementActiveJobs();

  try {
    // Step 1: Gate - Load document_version and branch by pipeline_status
    const version = await withTenant(workerDb, companyId, async (tx) => {
      const [v] = await tx
        .select({
          documentVersionId: documentVersions.documentVersionId,
          documentId: documentVersions.documentId,
          pipelineStatus: documentVersions.pipelineStatus,
          objectKey: documentVersions.objectKey,
          originalFilename: documentVersions.originalFilename,
          pageCount: documentVersions.pageCount,
        })
        .from(documentVersions)
        .where(eq(documentVersions.documentVersionId, documentVersionId))
        .limit(1);
      return v ?? null;
    });

    if (!version) {
      console.warn(`OCR job: document version ${documentVersionId} not found`);
      return;
    }

    // Skip if already at or beyond ocr_done
    // TODO: verify - Re-running OCR job for already completed version is no-op
    const skipStatuses = ["ocr_done", "embedding", "embedded", "extracting", "review_ready"];
    if (skipStatuses.includes(version.pipelineStatus)) {
      console.log(`OCR job: skipping ${documentVersionId}, already at ${version.pipelineStatus}`);
      return;
    }

    // Allow re-entry for ocr_processing, failed, and uploaded
    // TODO: verify - Re-running OCR job for crashed ocr_processing version is allowed re-entry
    const allowedStatuses = ["uploaded", "ocr_processing", "failed"];
    if (!allowedStatuses.includes(version.pipelineStatus)) {
      console.warn(`OCR job: unexpected status ${version.pipelineStatus} for ${documentVersionId}`);
      return;
    }

    // Step 2: Status update to ocr_processing
    await withTenant(workerDb, companyId, async (tx) => {
      await tx
        .update(documentVersions)
        .set({
          pipelineStatus: "ocr_processing",
          pipelineStatusUpdatedAt: new Date(),
        })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    });

    // Publish stage change
    await publishPipelineEvent(companyId, {
      id: nextEventId(),
      type: "pipeline_stage_changed",
      documentVersionId,
      documentId: version.documentId,
      pipelineStatus: "ocr_processing",
      timestamp: new Date().toISOString(),
    });

    // Step 3: Insert/update pipeline_run as running
    await withTenant(workerDb, companyId, async (tx) => {
      await tx
        .insert(pipelineRuns)
        .values({
          documentVersionId,
          companyId,
          status: "running",
        })
        .onConflictDoNothing();
    });

    // Step 4: Fetch source from R2
    const getCmd = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: version.objectKey,
    });
    const fileResponse = await r2Client.send(getCmd);
    if (!fileResponse.Body) {
      throw new Error(`Failed to fetch object ${version.objectKey} from R2`);
    }
    const fileBuffer = Buffer.from(await fileResponse.Body.transformToByteArray());

    // Determine mime type from extension
    const ext = version.originalFilename.split(".").pop()?.toLowerCase() ?? "pdf";
    const mimeType = ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`;

    // Step 5: Rasterization
    const pageImages = await convertToPageImages(fileBuffer, mimeType, version.pageCount);

    // Step 6: OCR per page (sequential to avoid rate limiting)
    const allParsedBlocks: import("@/lib/ocr/parse").ParsedBlock[] = [];

    // Process pages sequentially — PaddleOCR API rate-limits concurrent requests
    const concurrency = 1;
    for (let i = 0; i < pageImages.length; i += concurrency) {
      const batch = pageImages.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (pageImage) => {
          // Call PaddleOCR
          const ocrBoxes = await ocrPage(pageImage.buffer);

          // Parse and normalize
          const parsedBlocks = parseOCRResponse(
            ocrBoxes,
            pageImage.pageNumber,
            pageImage.width,
            pageImage.height
          );

          // Upload page PNG to R2
          await r2Client.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: `${companyId}/${documentVersionId}/pages/${pageImage.pageNumber}.png`,
              Body: pageImage.buffer,
              ContentType: "image/png",
            })
          );

          return parsedBlocks;
        })
      );

      for (const blocks of batchResults) {
        allParsedBlocks.push(...blocks);
      }
    }

    // Step 7: Chunking - merge + split
    const { blocksToInsert: mergedBlocks } = mergeAdjacentBlocks(allParsedBlocks);
    const finalBlocks = splitOversizedBlocks(mergedBlocks);

    // Step 8: Persist blocks - bulk insert evidence_blocks
    if (finalBlocks.length > 0) {
      await withTenant(workerDb, companyId, async (tx) => {
        // Delete existing blocks for this version (idempotency for re-runs)
        await tx
          .delete(evidenceBlocks)
          .where(
            and(
              eq(evidenceBlocks.documentVersionId, documentVersionId),
              eq(evidenceBlocks.companyId, companyId)
            )
          );

        // Bulk insert in chunks to avoid oversized queries
        const insertChunkSize = 100;
        for (let i = 0; i < finalBlocks.length; i += insertChunkSize) {
          const chunk = finalBlocks.slice(i, i + insertChunkSize);
          await tx.insert(evidenceBlocks).values(
            chunk.map((block) => ({
              blockId: block.tempId,
              documentVersionId,
              companyId,
              pageNumber: block.pageNumber,
              bbox: block.bbox,
              text: block.text,
              blockType: block.blockType,
              ocrConfidence: block.ocrConfidence,
              lowConfidence: block.lowConfidence,
              chunkType: block.chunkType,
              embeddingStatus: "pending" as const,
              mergedBlockIds: block.mergedBlockIds,
              parentBlockId: block.parentBlockId,
            }))
          );
        }
      });
    }

    // Step 9: Finalize OCR - update status and pipeline run
    await withTenant(workerDb, companyId, async (tx) => {
      await tx
        .update(documentVersions)
        .set({
          pipelineStatus: "ocr_done",
          pageCount: pageImages.length,
          pipelineStatusUpdatedAt: new Date(),
        })
        .where(eq(documentVersions.documentVersionId, documentVersionId));

      await tx
        .update(pipelineRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(pipelineRuns.documentVersionId, documentVersionId));
    });

    // Publish stage change
    await publishPipelineEvent(companyId, {
      id: nextEventId(),
      type: "pipeline_stage_changed",
      documentVersionId,
      documentId: version.documentId,
      pipelineStatus: "ocr_done",
      timestamp: new Date().toISOString(),
    });

    // Step 10: Fan-out next stage - enqueue embedding-job
    await embeddingQueue.add(
      "process-embedding-document-version",
      {
        documentVersionId,
        companyId,
      },
      { attempts: 2, backoff: { type: "exponential", delay: 1000 } }
    );

    // Insert queued pipeline_run for embedding stage
    await withTenant(workerDb, companyId, async (tx) => {
      await tx.insert(pipelineRuns).values({
        documentVersionId,
        companyId,
        status: "running",
      });
    });
  } finally {
    decrementActiveJobs();
  }
}
