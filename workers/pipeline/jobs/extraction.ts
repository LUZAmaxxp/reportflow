import type { Job } from "bullmq";
import { workerDb } from "../db";
import { withTenant } from "@/lib/db/rls";
import { documentVersions, documents } from "@/lib/db/schema/documents";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { pipelineRuns } from "@/lib/db/schema/pipeline";
import { observations } from "@/lib/db/schema/observations";
import { notifications } from "@/lib/db/schema/notifications";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { hybridRetrieval, MIN_BLOCKS_FOR_EXTRACTION } from "@/lib/extraction/hybridRetrieval";
import { grokExtract } from "@/lib/extraction/grokExtract";
import { parseExtractionResponse, ExtractionParseError } from "@/lib/extraction/parseExtraction";
import { validateBlockIds } from "@/lib/extraction/hallucinationGuard";
import { createExactConflicts } from "@/lib/extraction/exactConflict";
import { eq, and, sql } from "drizzle-orm";
import { incrementActiveJobs, decrementActiveJobs } from "../health";
import { env } from "@/lib/env";

export interface ExtractionJobPayload {
  documentVersionId: string;
  companyId: string;
}

// SPEC DEVIATION: FR-18 detected type taxonomy uses
// sustainability_report|annual_report|audit_report|policy|other
// while base SQL detected_doc_type uses a different taxonomy.
// Slice 3 keeps classifier output and maps at persistence boundaries.
const CLASSIFIER_TYPES = ["sustainability_report", "annual_report", "audit_report", "policy", "other"] as const;
type ClassifierType = typeof CLASSIFIER_TYPES[number];

// Map classifier output to storage enum values
const CLASSIFIER_TO_STORAGE: Record<ClassifierType, string> = {
  sustainability_report: "sustainability_report",
  annual_report: "financial_statement",
  audit_report: "financial_statement",
  policy: "other",
  other: "other",
};

/**
 * BullMQ processor for extraction-job implementing the full Slice 3 pipeline stage.
 */
export async function processExtractionJob(job: Job<ExtractionJobPayload>): Promise<void> {
  const { documentVersionId, companyId } = job.data;
  const jobStartTime = Date.now();
  incrementActiveJobs();

  try {
    // Step 1: Gate check
    const version = await withTenant(workerDb, companyId, async (tx) => {
      const [v] = await tx
        .select({
          documentVersionId: documentVersions.documentVersionId,
          documentId: documentVersions.documentId,
          pipelineStatus: documentVersions.pipelineStatus,
          originalFilename: documentVersions.originalFilename,
        })
        .from(documentVersions)
        .where(eq(documentVersions.documentVersionId, documentVersionId))
        .limit(1);
      return v ?? null;
    });

    if (!version) {
      console.warn(`Extraction job: document version ${documentVersionId} not found`);
      return;
    }

    // Skip if already review_ready or later completion state
    const skipStatuses = ["review_ready"];
    if (skipStatuses.includes(version.pipelineStatus)) {
      console.log(`Extraction job: skipping ${documentVersionId}, already at ${version.pipelineStatus}`);
      return;
    }

    // Skip if earlier than embedded
    const earlierStatuses = ["uploaded", "ocr_processing", "ocr_done", "embedding"];
    if (earlierStatuses.includes(version.pipelineStatus)) {
      console.warn(`Extraction job: status ${version.pipelineStatus} is before embedded for ${documentVersionId}`);
      return;
    }

    // Allow re-entry for extracting without completed pipeline_run (crash recovery)
    const allowedStatuses = ["embedded", "extracting", "failed"];
    if (!allowedStatuses.includes(version.pipelineStatus)) {
      console.warn(`Extraction job: unexpected status ${version.pipelineStatus} for ${documentVersionId}`);
      return;
    }

    // Load document metadata for prompt context
    const doc = await withTenant(workerDb, companyId, async (tx) => {
      const [d] = await tx
        .select({
          documentId: documents.documentId,
          title: documents.title,
          categoryId: documents.categoryId,
        })
        .from(documents)
        .where(eq(documents.documentId, version.documentId))
        .limit(1);
      return d ?? null;
    });

    // Step 2: Start pipeline run
    let runId: string | null = null;
    await withTenant(workerDb, companyId, async (tx) => {
      const [run] = await tx
        .insert(pipelineRuns)
        .values({
          documentVersionId,
          companyId,
          status: "running",
        })
        .returning({ runId: pipelineRuns.runId });
      runId = run.runId;
    });

    // Step 3: Mark stage extracting
    await withTenant(workerDb, companyId, async (tx) => {
      await tx
        .update(documentVersions)
        .set({
          pipelineStatus: "extracting",
          pipelineStatusUpdatedAt: new Date(),
        })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    });

    await publishPipelineEvent(companyId, {
      id: nextEventId(),
      type: "pipeline_stage_changed",
      documentVersionId,
      documentId: version.documentId,
      pipelineStatus: "extracting",
      timestamp: new Date().toISOString(),
    });

    // Step 4: FR-18 document type auto-detect
    let detectedType: ClassifierType = "other";
    try {
      const firstBlocks = await withTenant(workerDb, companyId, async (tx) => {
        return tx
          .select({
            text: evidenceBlocks.text,
          })
          .from(evidenceBlocks)
          .where(eq(evidenceBlocks.documentVersionId, documentVersionId))
          .orderBy(evidenceBlocks.pageNumber)
          .limit(5);
      });

      if (firstBlocks.length > 0) {
        const sampleText = firstBlocks.map((b: any) => b.text).join("\n\n");
        const classifierResponse = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.XAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "grok-4-1-fast-reasoning",
            messages: [
              {
                role: "system",
                content: `Classify this document into exactly one of these types: sustainability_report, annual_report, audit_report, policy, other. Return ONLY the type string, nothing else.`,
              },
              {
                role: "user",
                content: sampleText.slice(0, 3000),
              },
            ],
            temperature: 0,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (classifierResponse.ok) {
          const data = await classifierResponse.json();
          const raw = data.choices?.[0]?.message?.content?.trim().toLowerCase();
          if (CLASSIFIER_TYPES.includes(raw as ClassifierType)) {
            detectedType = raw as ClassifierType;
          }
        }
      }

      // Persist detected type using storage enum mapping
      const storageType = CLASSIFIER_TO_STORAGE[detectedType];
      await withTenant(workerDb, companyId, async (tx) => {
        await tx
          .update(documentVersions)
          .set({ detectedType: storageType as any })
          .where(eq(documentVersions.documentVersionId, documentVersionId));
      });
    } catch (classifierErr) {
      console.warn("[Extraction] FR-18 classifier failed, using 'other':", classifierErr);
    }

    // Steps 5-8: Hybrid retrieval
    const retrievedBlocks = await withTenant(workerDb, companyId, async (tx) => {
      return hybridRetrieval(tx, documentVersionId);
    });

    console.log(`[Extraction] Hybrid retrieval returned ${retrievedBlocks.length} blocks for ${documentVersionId}`);
    if (retrievedBlocks.length > 0) {
      console.log(`[Extraction] Sample blocks:`, retrievedBlocks.slice(0, 3).map(b => ({
        blockId: b.blockId,
        page: b.pageNumber,
        textLen: b.text.length,
        textPreview: b.text.slice(0, 120),
        fusedScore: b.fusedScore,
      })));
    }

    // Step 9: Low-block guard
    if (retrievedBlocks.length < MIN_BLOCKS_FOR_EXTRACTION) {
      console.warn(
        `[Extraction] Low-block guard: only ${retrievedBlocks.length} blocks (threshold: ${MIN_BLOCKS_FOR_EXTRACTION})`
      );

      await withTenant(workerDb, companyId, async (tx) => {
        await tx
          .update(documentVersions)
          .set({
            pipelineStatus: "review_ready",
            pipelineStatusUpdatedAt: new Date(),
          })
          .where(eq(documentVersions.documentVersionId, documentVersionId));

        if (runId) {
          await tx
            .update(pipelineRuns)
            .set({
              status: "completed",
              completedAt: new Date(),
              observationsCreated: 0,
              observationsSkipped: 0,
            })
            .where(eq(pipelineRuns.runId, runId));
        }
      });

      await publishPipelineEvent(companyId, {
        id: nextEventId(),
        type: "extraction_complete",
        documentVersionId,
        documentId: version.documentId,
        observationCount: 0,
        warning: "insufficient_blocks",
        timestamp: new Date().toISOString(),
      });

      await publishPipelineEvent(companyId, {
        id: nextEventId(),
        type: "pipeline_stage_changed",
        documentVersionId,
        documentId: version.documentId,
        pipelineStatus: "review_ready",
        timestamp: new Date().toISOString(),
      });

      return;
    }

    // Step 10-11: Build prompt and call Grok extractor
    console.log(`[Extraction] Calling Grok with ${retrievedBlocks.length} blocks, filename=${version.originalFilename}`);
    const extractionResult = await grokExtract(
      {
        filename: version.originalFilename,
        category: null,
        client: null,
        blocks: retrievedBlocks,
      },
      jobStartTime
    );

    console.log(`[Extraction] Grok result: success=${extractionResult.success}, retried=${extractionResult.retried}, error=${extractionResult.error}`);
    console.log(`[Extraction] Grok rawJson type=${typeof extractionResult.rawJson}, isArray=${Array.isArray(extractionResult.rawJson)}, length=${Array.isArray(extractionResult.rawJson) ? extractionResult.rawJson.length : 'N/A'}`);
    if (Array.isArray(extractionResult.rawJson)) {
      console.log(`[Extraction] Grok rawJson sample:`, JSON.stringify(extractionResult.rawJson.slice(0, 2), null, 2).slice(0, 1000));
    } else {
      console.log(`[Extraction] Grok rawJson:`, JSON.stringify(extractionResult.rawJson, null, 2)?.slice(0, 1000));
    }

    if (!extractionResult.success) {
      // Step 12: Fail on invalid output
      const errorMsg = extractionResult.error ?? "Grok extraction failed";
      await withTenant(workerDb, companyId, async (tx) => {
        await tx
          .update(documentVersions)
          .set({
            pipelineStatus: "failed",
            pipelineErrorMessage: errorMsg.slice(0, 500),
            pipelineStatusUpdatedAt: new Date(),
          })
          .where(eq(documentVersions.documentVersionId, documentVersionId));

        if (runId) {
          await tx
            .update(pipelineRuns)
            .set({
              status: "failed",
              completedAt: new Date(),
            })
            .where(eq(pipelineRuns.runId, runId));
        }
      });

      await publishPipelineEvent(companyId, {
        id: nextEventId(),
        type: "pipeline_failed",
        documentVersionId,
        documentId: version.documentId,
        stage: "extraction",
        error: errorMsg.slice(0, 500),
        timestamp: new Date().toISOString(),
      });

      return;
    }

    // Step 12: Parse and validate
    let parsedObservations;
    try {
      parsedObservations = parseExtractionResponse(extractionResult.rawJson);
      console.log(`[Extraction] Parsed ${parsedObservations.length} observations from Grok response`);
      if (parsedObservations.length > 0) {
        console.log(`[Extraction] Sample parsed obs:`, parsedObservations.slice(0, 2).map(o => ({
          key: o.normalized_key,
          value: o.value,
          blockIds: o.evidence_block_ids,
          confidence: o.confidence_score,
        })));
      }
    } catch (parseErr) {
      // On schema-invalid output: fail extraction stage
      console.error(`[Extraction] Parse failed:`, parseErr instanceof ExtractionParseError ? parseErr.zodError.issues.slice(0, 5) : parseErr);
      const errorMsg =
        parseErr instanceof ExtractionParseError
          ? `Schema validation failed: ${parseErr.message.slice(0, 400)}`
          : "Extraction parse error";

      await withTenant(workerDb, companyId, async (tx) => {
        await tx
          .update(documentVersions)
          .set({
            pipelineStatus: "failed",
            pipelineErrorMessage: errorMsg,
            pipelineStatusUpdatedAt: new Date(),
          })
          .where(eq(documentVersions.documentVersionId, documentVersionId));

        if (runId) {
          await tx
            .update(pipelineRuns)
            .set({
              status: "failed",
              completedAt: new Date(),
            })
            .where(eq(pipelineRuns.runId, runId));
        }
      });

      await publishPipelineEvent(companyId, {
        id: nextEventId(),
        type: "pipeline_failed",
        documentVersionId,
        documentId: version.documentId,
        stage: "extraction",
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });

      return;
    }

    // Step 13: Hallucination guard
    const knownBlockIds = new Set(retrievedBlocks.map((b) => b.blockId));
    // Also load all block ids for the document version to be thorough
    const allBlockIds = await withTenant(workerDb, companyId, async (tx) => {
      const blocks = await tx
        .select({ blockId: evidenceBlocks.blockId })
        .from(evidenceBlocks)
        .where(eq(evidenceBlocks.documentVersionId, documentVersionId));
      return new Set<string>(blocks.map((b: any) => b.blockId as string));
    });

    console.log(`[Extraction] Hallucination guard: ${allBlockIds.size} known block IDs in DB, ${knownBlockIds.size} from retrieval`);
    const guardResult = validateBlockIds(parsedObservations, allBlockIds);
    const validObservations = guardResult.valid;
    console.log(`[Extraction] Hallucination guard result: ${validObservations.length} valid, ${guardResult.skippedCount} skipped`);
    if (guardResult.skippedCount > 0) {
      console.log(`[Extraction] Skipped details:`, guardResult.skippedDetails.slice(0, 5));
    }

    // Step 14: Insert observations
    const insertedObservationRefs: Array<{
      observationId: string;
      normalizedKey: string;
      periodStart: string | null;
      periodEnd: string | null;
    }> = [];

    if (validObservations.length > 0) {
      await withTenant(workerDb, companyId, async (tx) => {
        for (const obs of validObservations) {
          const [inserted] = await tx
            .insert(observations)
            .values({
              companyId,
              label: obs.label,
              normalizedKey: obs.normalized_key,
              value: obs.value,
              numericValue: obs.numeric_value !== null ? String(obs.numeric_value) : null,
              unit: obs.unit ?? "",
              dataType: obs.data_type,
              timeBehavior: obs.time_behavior,
              periodStart: obs.period_start,
              periodEnd: obs.period_end,
              categoryId: doc?.categoryId ?? null,
              sourceDocumentVersionId: documentVersionId,
              status: "candidate",
              provenanceType: "document",
              evidenceBlockIds: obs.evidence_block_ids,
              confidenceScore: obs.confidence_score,
              extractionRunId: runId,
            })
            .returning({
              observationId: observations.observationId,
            });

          insertedObservationRefs.push({
            observationId: inserted.observationId,
            normalizedKey: obs.normalized_key,
            periodStart: obs.period_start,
            periodEnd: obs.period_end,
          });
        }
      });
    }

    // Steps 15-16: Exact-match conflict lookup and insert conflict_case records
    let conflictsCreated = 0;
    if (insertedObservationRefs.length > 0) {
      await withTenant(workerDb, companyId, async (tx) => {
        const result = await createExactConflicts(tx, companyId, insertedObservationRefs);
        conflictsCreated = result.conflictsCreated;
      });
    }

    // Step 17: Finalize pipeline run
    await withTenant(workerDb, companyId, async (tx) => {
      if (runId) {
        await tx
          .update(pipelineRuns)
          .set({
            status: "completed",
            completedAt: new Date(),
            observationsCreated: insertedObservationRefs.length,
            observationsSkipped: guardResult.skippedCount,
          })
          .where(eq(pipelineRuns.runId, runId));
      }
    });

    // Step 18: Mark review ready
    await withTenant(workerDb, companyId, async (tx) => {
      await tx
        .update(documentVersions)
        .set({
          pipelineStatus: "review_ready",
          pipelineStatusUpdatedAt: new Date(),
        })
        .where(eq(documentVersions.documentVersionId, documentVersionId));
    });

    await publishPipelineEvent(companyId, {
      id: nextEventId(),
      type: "pipeline_stage_changed",
      documentVersionId,
      documentId: version.documentId,
      pipelineStatus: "review_ready",
      timestamp: new Date().toISOString(),
    });

    await publishPipelineEvent(companyId, {
      id: nextEventId(),
      type: "extraction_complete",
      documentVersionId,
      documentId: version.documentId,
      observationCount: insertedObservationRefs.length,
      timestamp: new Date().toISOString(),
    });

    // Step 19: Create notification
    await withTenant(workerDb, companyId, async (tx) => {
      await tx.insert(notifications).values({
        companyId,
        type: "pipeline_completed",
        payload: {
          document_id: version.documentId,
          observation_count: insertedObservationRefs.length,
        },
      });
    });

    console.log(
      `[Extraction] Completed for ${documentVersionId}: ${insertedObservationRefs.length} observations created, ${guardResult.skippedCount} skipped, ${conflictsCreated} conflicts flagged`
    );
  } catch (err) {
    // Handle failures/timeouts with DLQ-compatible path
    const errorMessage = err instanceof Error ? err.message : "Unknown extraction error";
    const isTimeout = Date.now() - jobStartTime > 300000;

    console.error(`[Extraction] Failed for ${documentVersionId}:`, err);

    try {
      await withTenant(workerDb, companyId, async (tx) => {
        await tx
          .update(documentVersions)
          .set({
            pipelineStatus: "failed",
            pipelineErrorMessage: isTimeout ? "extraction_timeout" : errorMessage.slice(0, 500),
            pipelineStatusUpdatedAt: new Date(),
          })
          .where(eq(documentVersions.documentVersionId, documentVersionId));
      });
    } catch (updateErr) {
      console.error("[Extraction] Failed to update status on error:", updateErr);
    }

    throw err; // Re-throw for BullMQ retry/DLQ handling
  } finally {
    decrementActiveJobs();
  }
}
