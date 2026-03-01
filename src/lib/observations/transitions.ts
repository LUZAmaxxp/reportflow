import { eq, sql } from "drizzle-orm";
import { observations } from "@/lib/db/schema/observations";
import { attestationRecords } from "@/lib/db/schema/observations";
import { auditLog } from "@/lib/db/schema/notifications";
import { isValidTransition, type ObservationStatus, type TransitionRole } from "./stateMachine";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { semanticConflictQueue } from "@/lib/queues";
import { QUEUE_NAMES } from "@/lib/constants";

/**
 * Transactional helper implementing side-effect-safe status transitions.
 * Runs inside a single DB transaction.
 */

export interface TransitionResult {
  success: boolean;
  error?: string;
  errorCode?: "invalid_transition" | "not_found";
  from?: ObservationStatus;
  to?: ObservationStatus;
  observationId?: string;
  updatedAt?: string;
}

/**
 * Apply a status transition with all side effects inside one transaction.
 * - Locks row with SELECT FOR UPDATE
 * - Validates transition
 * - Writes attestation_record and audit_log as required
 * - On approved: enqueues semantic-conflict-job and publishes observation_approved
 */
export async function applyTransition(
  tx: any,
  obsId: string,
  toStatus: ObservationStatus,
  userId: string,
  role: TransitionRole,
  companyId: string
): Promise<TransitionResult> {
  // Lock row with SELECT FOR UPDATE
  const lockResult = await tx.execute(
    sql`SELECT observation_id, status, company_id
        FROM observation
        WHERE observation_id = ${obsId}
          AND company_id = ${companyId}
        FOR UPDATE`
  );

  const rows = Array.isArray(lockResult) ? lockResult : (lockResult as any).rows ?? [];
  if (rows.length === 0) {
    return { success: false, error: "Observation not found in tenant scope", errorCode: "not_found" };
  }

  const currentStatus = rows[0].status as ObservationStatus;

  // Validate transition
  if (!isValidTransition(currentStatus, toStatus, role)) {
    return {
      success: false,
      error: `Invalid transition from ${currentStatus} to ${toStatus}`,
      errorCode: "invalid_transition",
      from: currentStatus,
      to: toStatus,
    };
  }

  const now = new Date();

  // Update observation status
  await tx
    .update(observations)
    .set({
      status: toStatus,
      updatedAt: now,
    })
    .where(eq(observations.observationId, obsId));

  // Insert attestation_record for approved or rejected transitions
  if (toStatus === "approved" || toStatus === "rejected") {
    await tx.insert(attestationRecords).values({
      companyId,
      createdBy: userId,
      note: `Status changed from ${currentStatus} to ${toStatus}`,
      sourceReference: obsId,
    });
  }

  // Insert audit_log diff
  await tx.insert(auditLog).values({
    companyId,
    entityType: "observation",
    entityId: obsId,
    action: `status_${toStatus}`,
    actorId: userId,
    metadata: {
      from: currentStatus,
      to: toStatus,
    },
  });

  // On approved: enqueue semantic-conflict-job and publish SSE event
  if (toStatus === "approved") {
    await semanticConflictQueue.add(
      QUEUE_NAMES.SEMANTIC_CONFLICT,
      {
        observationId: obsId,
        companyId,
        reason: "status_approved",
      }
    );

    // Get document id from observation for SSE event
    const [obs] = await tx
      .select({
        sourceDocumentVersionId: observations.sourceDocumentVersionId,
      })
      .from(observations)
      .where(eq(observations.observationId, obsId));

    await publishPipelineEvent(companyId, {
      id: nextEventId(),
      type: "observation_approved",
      observationId: obsId,
      documentId: obs?.sourceDocumentVersionId ?? "",
      companyId,
      timestamp: now.toISOString(),
    });
  }

  return {
    success: true,
    observationId: obsId,
    from: currentStatus,
    to: toStatus,
    updatedAt: now.toISOString(),
  };
}
