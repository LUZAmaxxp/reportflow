import type { Job } from "bullmq";
import { workerDb } from "../db";
import { withTenant } from "@/lib/db/rls";
import { documentVersions } from "@/lib/db/schema/documents";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { pipelineRuns } from "@/lib/db/schema/pipeline";
import { embedTexts } from "@/lib/embeddings/openai";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { extractionQueue } from "@/lib/queues";
import { eq, and, ne, isNull, sql } from "drizzle-orm";
import { incrementActiveJobs, decrementActiveJobs } from "../health";

interface EmbeddingJobPayload {
  documentVersionId: string;
  companyId: string;
}

/**
 * Embedding pipeline job implementing:
 * - Status gate idempotency
 * - Status transitions ocr_done→embedding→embedded
 * - Select embeddable blocks (not low_confidence, not superseded, embedding null)
 * - Embed in batches of 512
 * - Update vectors and embedding_status
 * - Tolerate partial batch failure
 * - Publish events and enqueue extraction-job for Slice 3
 */
export async function processEmbeddingJob(job: Job<EmbeddingJobPayload>): Promise<void> {
  const { documentVersionId, companyId } = job.data;
  incrementActiveJobs();

  try {
    // Step 1: Gate - Load document_version and check status
    const version = await withTenant(workerDb, companyId, async (tx) => {
      const [v] = await tx
        .select({
          documentVersionId: documentVersions.documentVersionId,
          documentId: documentVersions.documentId,
          pipelineStatus: documentVersions.pipelineStatus,
        })
        .from(documentVersions)
        .where(eq(documentVersions.documentVersionId, documentVersionId))
        .limit(1);
      return v ?? null;
    });

    if (!version) {
      console.warn(`Embedding job: document version ${documentVersionId} not found`);
      return;
    }

    // Skip if already embedded or beyond
    const skipStatuses = ["embedded", "extracting", "review_ready"];
    if (skipStatuses.includes(version.pipelineStatus)) {
      console.log(`Embedding job: skipping ${documentVersionId}, already at ${version.pipelineStatus}`);
      return;
    }

    // Allow re-entry from embedding; proceed from ocr_done
    const allowedStatuses = ["ocr_done", "embedding", "failed"];
    if (!allowedStatuses.includes(version.pipelineStatus)) {
      console.warn(`Embedding job: status ${version.pipelineStatus} is before ocr_done for ${documentVersionId}`);
      return;
    }

    // Step 2: Status update to embedding
    await withTenant(workerDb, companyId, async (tx) => {
      await tx
        .update(documentVersions)
        .set({
          pipelineStatus: "embedding",
          pipelineStatusUpdatedAt: new Date(),
        })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    });

    await publishPipelineEvent(companyId, {
      id: nextEventId(),
      type: "pipeline_stage_changed",
      documentVersionId,
      documentId: version.documentId,
      pipelineStatus: "embedding",
      timestamp: new Date().toISOString(),
    });

    // Step 3: Candidate scan - select embeddable blocks
    const candidates = await withTenant(workerDb, companyId, async (tx) => {
      return tx
        .select({
          blockId: evidenceBlocks.blockId,
          text: evidenceBlocks.text,
        })
        .from(evidenceBlocks)
        .where(
          and(
            eq(evidenceBlocks.documentVersionId, documentVersionId),
            eq(evidenceBlocks.lowConfidence, false),
            ne(evidenceBlocks.chunkType, "superseded"),
            isNull(evidenceBlocks.embedding)
          )
        );
    });

    // Steps 4-6: Batch partition and embed
    if (candidates.length > 0) {
      const inputs = candidates.map((c: typeof candidates[number]) => ({
        blockId: c.blockId,
        text: c.text,
      }));

      const batchResults = await embedTexts(inputs);

      // Step 6-7: Persist vectors and handle partial failure
      for (const result of batchResults) {
        if (result.failed) {
          // Mark failed batch blocks
          console.warn(`Embedding batch failed: ${result.error}`);
          await withTenant(workerDb, companyId, async (tx) => {
            for (const blockId of result.blockIds) {
              await tx
                .update(evidenceBlocks)
                .set({ embeddingStatus: "failed" })
                .where(eq(evidenceBlocks.blockId, blockId));
            }
          });
        } else {
          // Update vectors for successful batch
          await withTenant(workerDb, companyId, async (tx) => {
            for (let i = 0; i < result.blockIds.length; i++) {
              await tx
                .update(evidenceBlocks)
                .set({
                  embedding: result.vectors[i],
                  embeddingStatus: "completed",
                })
                .where(eq(evidenceBlocks.blockId, result.blockIds[i]));
            }
          });
        }
      }
    }

    // Mark low_confidence and superseded blocks as skipped
    await withTenant(workerDb, companyId, async (tx) => {
      await tx
        .update(evidenceBlocks)
        .set({ embeddingStatus: "skipped" })
        .where(
          and(
            eq(evidenceBlocks.documentVersionId, documentVersionId),
            eq(evidenceBlocks.embeddingStatus, "pending"),
            sql`(${evidenceBlocks.lowConfidence} = true OR ${evidenceBlocks.chunkType} = 'superseded')`
          )
        );
    });

    // Step 8: Finalize embedding
    await withTenant(workerDb, companyId, async (tx) => {
      await tx
        .update(documentVersions)
        .set({
          pipelineStatus: "embedded",
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

    await publishPipelineEvent(companyId, {
      id: nextEventId(),
      type: "pipeline_stage_changed",
      documentVersionId,
      documentId: version.documentId,
      pipelineStatus: "embedded",
      timestamp: new Date().toISOString(),
    });

    // Step 9: Queue extraction (for Slice 3)
    await extractionQueue.add(
      "process-extraction-document-version",
      {
        documentVersionId,
        companyId,
      },
      { attempts: 2, backoff: { type: "exponential", delay: 1000 } }
    );

    // Insert queued extraction pipeline_run
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
