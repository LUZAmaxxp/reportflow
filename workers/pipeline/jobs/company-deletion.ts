import type { Job } from "bullmq";
import { workerDb } from "../db";
import { withTenant } from "@/lib/db/rls";
import { companies, users } from "@/lib/db/schema/auth";
import { documents, documentVersions, documentCategories, clients } from "@/lib/db/schema/documents";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { observations, attestationRecords, pendingManualObservations } from "@/lib/db/schema/observations";
import { derivationResults } from "@/lib/db/schema/derivations";
import { conflictCases, conflictResolutions } from "@/lib/db/schema/conflicts";
import { reports } from "@/lib/db/schema/reports";
import { chatSessions, chatMessages, notifications, auditLog } from "@/lib/db/schema/notifications";
import { preferenceMemoryPointers } from "@/lib/db/schema/memory";
import { pipelineRuns } from "@/lib/db/schema/pipeline";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { eq, and, ne } from "drizzle-orm";
import { r2Client, R2_BUCKET } from "@/lib/r2";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

interface CompanyDeletionPayload {
  company_id: string;
  triggered_by: string;
  audit_log_id?: string;
}

const TOTAL_STAGES = 20;

interface DeletionStage {
  index: number;
  label: string;
  stageName: string;
  execute: (tx: any, companyId: string) => Promise<number>;
}

async function emitProgress(
  companyId: string,
  stageName: string,
  recordsDeleted: number,
  currentStageIndex: number,
  status: "in_progress" | "complete" | "failed" = "in_progress",
  error?: string
) {
  await publishPipelineEvent(companyId, {
    id: nextEventId(),
    type: "data_deletion_progress" as any,
    company_id: companyId,
    stage: stageName,
    records_deleted: recordsDeleted,
    total_stages: TOTAL_STAGES,
    current_stage_index: currentStageIndex,
    status,
    ...(error ? { error } : {}),
    timestamp: new Date().toISOString(),
  } as any);
}

function deleteByCompany(table: any, companyId: string) {
  return workerDb.delete(table).where(eq(table.companyId, companyId));
}

export async function processCompanyDeletionJob(job: Job<CompanyDeletionPayload>): Promise<void> {
  const { company_id: companyId, triggered_by, audit_log_id } = job.data;
  console.log("[company-deletion] Starting", { companyId, triggeredBy: triggered_by });

  const stages: DeletionStage[] = [
    {
      index: 1,
      label: "Delete pending manual observations",
      stageName: "pending_manual_observations",
      execute: async (_, cid) => {
        const result = await workerDb.delete(pendingManualObservations).where(eq(pendingManualObservations.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 2,
      label: "Delete conflict resolutions",
      stageName: "conflict_resolutions",
      execute: async (_, cid) => {
        // Delete resolutions for conflicts belonging to this company
        const companyConflicts = await workerDb
          .select({ conflictId: conflictCases.conflictId })
          .from(conflictCases)
          .where(eq(conflictCases.companyId, cid));
        let count = 0;
        for (const c of companyConflicts) {
          const result = await workerDb.delete(conflictResolutions).where(eq(conflictResolutions.conflictId, c.conflictId));
          count += (result as any).rowCount ?? 0;
        }
        return count;
      },
    },
    {
      index: 3,
      label: "Delete conflict cases",
      stageName: "conflict_cases",
      execute: async (_, cid) => {
        const result = await workerDb.delete(conflictCases).where(eq(conflictCases.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 4,
      label: "Delete derivation results",
      stageName: "derivation_results",
      execute: async (_, cid) => {
        const result = await workerDb.delete(derivationResults).where(eq(derivationResults.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 5,
      label: "Delete report sections",
      stageName: "report_sections",
      execute: async () => {
        // report_sections table not present in schema - skip
        return 0;
      },
    },
    {
      index: 6,
      label: "Delete reports",
      stageName: "reports",
      execute: async (_, cid) => {
        const result = await workerDb.delete(reports).where(eq(reports.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 7,
      label: "Delete observations",
      stageName: "observations",
      execute: async (_, cid) => {
        const result = await workerDb.delete(observations).where(eq(observations.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 8,
      label: "Delete attestation records",
      stageName: "attestation_records",
      execute: async (_, cid) => {
        const result = await workerDb.delete(attestationRecords).where(eq(attestationRecords.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 9,
      label: "Delete evidence blocks",
      stageName: "evidence_blocks",
      execute: async (_, cid) => {
        const result = await workerDb.delete(evidenceBlocks).where(eq(evidenceBlocks.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 10,
      label: "Delete pipeline runs",
      stageName: "pipeline_runs",
      execute: async (_, cid) => {
        const result = await workerDb.delete(pipelineRuns).where(eq(pipelineRuns.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 11,
      label: "Delete document versions",
      stageName: "document_versions",
      execute: async (_, cid) => {
        const result = await workerDb.delete(documentVersions).where(eq(documentVersions.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 12,
      label: "Delete documents",
      stageName: "documents",
      execute: async (_, cid) => {
        const result = await workerDb.delete(documents).where(eq(documents.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 13,
      label: "Delete clients",
      stageName: "clients",
      execute: async (_, cid) => {
        const result = await workerDb.delete(clients).where(eq(clients.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 14,
      label: "Delete document categories",
      stageName: "document_categories",
      execute: async (_, cid) => {
        // Delete leaf-first is handled by DB cascade since parent FK is RESTRICT
        // But we do a simple delete since categories cascade from company
        const result = await workerDb.delete(documentCategories).where(eq(documentCategories.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 15,
      label: "Delete chat sessions and messages",
      stageName: "chat_sessions",
      execute: async (_, cid) => {
        // Messages cascade via session FK, so delete sessions (which cascades messages)
        const result = await workerDb.delete(chatSessions).where(eq(chatSessions.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 16,
      label: "Delete audit logs",
      stageName: "audit_logs",
      execute: async (_, cid) => {
        // Keep the final audit entry from the trigger endpoint
        let deleteQuery;
        if (audit_log_id) {
          deleteQuery = workerDb.delete(auditLog).where(
            and(eq(auditLog.companyId, cid), ne(auditLog.logId, audit_log_id))
          );
        } else {
          deleteQuery = workerDb.delete(auditLog).where(eq(auditLog.companyId, cid));
        }
        const result = await deleteQuery;
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 17,
      label: "Delete notification preferences",
      stageName: "notification_preferences",
      execute: async (_, cid) => {
        const r1 = await workerDb.delete(notifications).where(eq(notifications.companyId, cid));
        const r2 = await workerDb.delete(preferenceMemoryPointers).where(eq(preferenceMemoryPointers.companyId, cid));
        return ((r1 as any).rowCount ?? 0) + ((r2 as any).rowCount ?? 0);
      },
    },
    {
      index: 18,
      label: "Delete users",
      stageName: "users",
      execute: async (_, cid) => {
        const result = await workerDb.delete(users).where(eq(users.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
    {
      index: 19,
      label: "Clean up R2 objects",
      stageName: "r2_cleanup",
      execute: async (_, cid) => {
        let deletedCount = 0;
        try {
          // List and delete all objects with company prefix
          const prefixes = [`documents/${cid}/`, `reports/${cid}/`];
          for (const prefix of prefixes) {
            let continuationToken: string | undefined;
            do {
              const listResult = await r2Client.send(
                new ListObjectsV2Command({
                  Bucket: R2_BUCKET,
                  Prefix: prefix,
                  ContinuationToken: continuationToken,
                })
              );

              if (listResult.Contents && listResult.Contents.length > 0) {
                await r2Client.send(
                  new DeleteObjectsCommand({
                    Bucket: R2_BUCKET,
                    Delete: {
                      Objects: listResult.Contents.map((obj) => ({ Key: obj.Key })),
                    },
                  })
                );
                deletedCount += listResult.Contents.length;
              }

              continuationToken = listResult.NextContinuationToken;
            } while (continuationToken);
          }
        } catch (err) {
          console.error("[company-deletion] R2 cleanup error (non-fatal)", err);
        }
        return deletedCount;
      },
    },
    {
      index: 20,
      label: "Delete company row and complete",
      stageName: "complete",
      execute: async (_, cid) => {
        // Delete the remaining audit log entry too
        await workerDb.delete(auditLog).where(eq(auditLog.companyId, cid));
        const result = await workerDb.delete(companies).where(eq(companies.companyId, cid));
        return (result as any).rowCount ?? 0;
      },
    },
  ];

  for (const stage of stages) {
    try {
      console.log(`[company-deletion] Stage ${stage.index}/${TOTAL_STAGES}: ${stage.label}`);
      const recordsDeleted = await stage.execute(workerDb, companyId);
      console.log(`[company-deletion] Stage ${stage.index} complete, deleted ${recordsDeleted} records`);

      const isComplete = stage.index === TOTAL_STAGES;
      await emitProgress(
        companyId,
        stage.stageName,
        recordsDeleted,
        stage.index,
        isComplete ? "complete" : "in_progress"
      );
    } catch (err) {
      console.error(`[company-deletion] Stage ${stage.index} failed:`, err);
      await emitProgress(
        companyId,
        "failed",
        0,
        stage.index,
        "failed",
        err instanceof Error ? err.message : "Unknown error"
      );
      throw err; // Let BullMQ retry
    }
  }

  console.log("[company-deletion] Complete", { companyId });
}
