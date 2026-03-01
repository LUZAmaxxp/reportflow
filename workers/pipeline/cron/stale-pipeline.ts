import { workerDb } from "../db";
import { documentVersions } from "@/lib/db/schema/documents";
import { notifications } from "@/lib/db/schema/notifications";
import { pipelineRuns } from "@/lib/db/schema/pipeline";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { sql, eq, and, inArray } from "drizzle-orm";

export const STALE_PIPELINE_THRESHOLD_MINUTES = 10;
export const STALE_PIPELINE_SCAN_EVERY_MS = 300000; // 5 minutes

const STALE_STATUSES = ["ocr_processing", "embedding", "extracting"] as const;

/**
 * Every 5 minutes finds document_versions stuck in ocr_processing, embedding,
 * extracting for >10 minutes by pipeline_status_updated_at, marks failed with
 * message 'Pipeline stalled — timed out', inserts notification, and emits
 * pipeline_failed event.
 */
export async function stalePipelineSweep(): Promise<void> {
  try {
    const thresholdDate = new Date(Date.now() - STALE_PIPELINE_THRESHOLD_MINUTES * 60 * 1000);

    // Find stalled versions
    const stalledVersions = await workerDb
      .select({
        documentVersionId: documentVersions.documentVersionId,
        documentId: documentVersions.documentId,
        companyId: documentVersions.companyId,
        pipelineStatus: documentVersions.pipelineStatus,
      })
      .from(documentVersions)
      .where(
        and(
          sql`${documentVersions.pipelineStatus} IN ('ocr_processing', 'embedding', 'extracting')`,
          sql`${documentVersions.pipelineStatusUpdatedAt} < ${thresholdDate}`
        )
      );

    if (stalledVersions.length === 0) {
      return;
    }

    console.log(`Stale pipeline sweep: found ${stalledVersions.length} stalled versions`);

    const errorMessage = "Pipeline stalled — timed out";

    for (const stalled of stalledVersions) {
      const stage = stalled.pipelineStatus === "ocr_processing"
        ? "ocr"
        : stalled.pipelineStatus === "embedding"
        ? "embedding"
        : "extraction";

      // Mark failed
      await workerDb
        .update(documentVersions)
        .set({
          pipelineStatus: "failed",
          pipelineErrorMessage: errorMessage,
          pipelineStatusUpdatedAt: new Date(),
        })
        .where(eq(documentVersions.documentVersionId, stalled.documentVersionId));

      // Mark pipeline run as failed
      await workerDb
        .update(pipelineRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
        })
        .where(eq(pipelineRuns.documentVersionId, stalled.documentVersionId));

      // Insert notification
      await workerDb.insert(notifications).values({
        companyId: stalled.companyId,
        type: "pipeline_failed",
        payload: {
          documentVersionId: stalled.documentVersionId,
          documentId: stalled.documentId,
          stage,
          error: errorMessage,
        },
      });

      // Publish SSE event
      // TODO: verify - Stale-pipeline sweep marks versions stuck >10 minutes as failed and inserts notification
      await publishPipelineEvent(stalled.companyId, {
        id: nextEventId(),
        type: "pipeline_failed",
        documentVersionId: stalled.documentVersionId,
        documentId: stalled.documentId,
        stage: stage as "ocr" | "embedding" | "extraction",
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    // Step 4: Audit run - record counts in worker logs for observability
    console.log(`Stale pipeline sweep completed: marked ${stalledVersions.length} versions as failed`);
  } catch (error) {
    // If sweep fails, next repeat run retries naturally
    console.error("Stale pipeline sweep error:", error);
  }
}
