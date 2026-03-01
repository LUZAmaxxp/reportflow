import { workerDb } from "./db";
import { withTenant } from "@/lib/db/rls";
import { documentVersions } from "@/lib/db/schema/documents";
import { pipelineRuns } from "@/lib/db/schema/pipeline";
import { notifications } from "@/lib/db/schema/notifications";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { eq } from "drizzle-orm";
import type { Job } from "bullmq";

/**
 * On exhausted retries:
 * - Updates document_version.pipeline_status = 'failed'
 * - Sets pipeline_error_message
 * - Marks pipeline_run failed
 * - Inserts notification (type pipeline_failed)
 * - Publishes pipeline_failed SSE event with stage and error text
 */
export async function handleTerminalFailure(
  job: Job,
  error: Error,
  stage: "ocr" | "embedding" | "extraction"
): Promise<void> {
  const { documentVersionId, companyId } = job.data as {
    documentVersionId: string;
    companyId: string;
  };

  const errorMessage = error.message || "Unknown pipeline error";

  try {
    await withTenant(workerDb, companyId, async (tx) => {
      // Update document version to failed
      const [updatedVersion] = await tx
        .update(documentVersions)
        .set({
          pipelineStatus: "failed",
          pipelineErrorMessage: errorMessage,
          pipelineStatusUpdatedAt: new Date(),
        })
        .where(eq(documentVersions.documentVersionId, documentVersionId))
        .returning({ documentId: documentVersions.documentId });

      // Mark pipeline run as failed
      await tx
        .update(pipelineRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
        })
        .where(eq(pipelineRuns.documentVersionId, documentVersionId));

      // Insert notification
      if (updatedVersion) {
        await tx.insert(notifications).values({
          companyId,
          type: "pipeline_failed",
          payload: {
            documentVersionId,
            documentId: updatedVersion.documentId,
            stage,
            error: errorMessage,
          },
        });

        // Publish SSE event
        await publishPipelineEvent(companyId, {
          id: nextEventId(),
          type: "pipeline_failed",
          documentVersionId,
          documentId: updatedVersion.documentId,
          stage,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        });
      }
    });
  } catch (dlqError) {
    console.error("DLQ handler error", dlqError);
  }
}
