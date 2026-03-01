import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { conflictCases, conflictResolutions } from "@/lib/db/schema/conflicts";
import { observations } from "@/lib/db/schema/observations";
import { derivationResults } from "@/lib/db/schema/derivations";
import { auditLog } from "@/lib/db/schema/notifications";
import { publishNotification } from "@/lib/notifications/publish";
import { eq, and, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

export interface ResolveConflictRequest {
  chosenObservationId: string;
  reason?: string;
}

export interface ResolveConflictResponse {
  conflictId: string;
  resolutionStatus: "user_overridden";
  winningObservationId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
  }

  const { user_id, company_id, role } = session.user;

  // Enforce role editor|admin (viewer => 403)
  if (role === "viewer") {
    return NextResponse.json({ code: "FORBIDDEN_ROLE", message: "Viewer role cannot resolve conflicts" }, { status: 403 });
  }

  const { id: conflictId } = await params;

  // Parse and validate body
  let body: ResolveConflictRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "VALIDATION_ERROR", message: "Invalid JSON body" }, { status: 422 });
  }

  const { chosenObservationId, reason } = body;

  if (!chosenObservationId || !UUID_RE.test(chosenObservationId)) {
    return NextResponse.json({ code: "VALIDATION_ERROR", message: "chosenObservationId must be a valid UUID" }, { status: 422 });
  }

  if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
    return NextResponse.json({ code: "VALIDATION_ERROR", message: "reason max length 500 chars" }, { status: 422 });
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Look up conflict case in tenant scope
      const [conflict] = await tx
        .select()
        .from(conflictCases)
        .where(
          and(
            eq(conflictCases.conflictId, conflictId),
            eq(conflictCases.companyId, company_id)
          )
        )
        .limit(1);

      if (!conflict) {
        return { error: "CONFLICT_NOT_FOUND", status: 404 };
      }

      // Already user_overridden conflict cannot be re-overridden without admin role
      if (conflict.resolutionStatus === "user_overridden" && role !== "admin") {
        return { error: "FORBIDDEN_ROLE", status: 403, message: "Non-admin cannot re-override" };
      }

      // Validate chosenObservationId exists in conflict observation_ids
      if (!conflict.observationIds.includes(chosenObservationId)) {
        return { error: "OBSERVATION_NOT_IN_CONFLICT", status: 422 };
      }

      // In single DB transaction:
      // 1. Set chosen observation approved
      await tx
        .update(observations)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(observations.observationId, chosenObservationId));

      // 2. Set other approved observations superseded
      const otherObsIds = conflict.observationIds.filter((id: string) => id !== chosenObservationId);
      for (const otherId of otherObsIds) {
        await tx
          .update(observations)
          .set({ status: "superseded", updatedAt: new Date() })
          .where(
            and(
              eq(observations.observationId, otherId),
              eq(observations.status, "approved")
            )
          );
      }

      // 3. Insert conflict_resolution
      const resolutionId = uuidv7();
      await tx.insert(conflictResolutions).values({
        resolutionId,
        conflictId,
        chosenObservationId,
        resolvedBy: user_id,
        reason: reason ?? null,
      });

      // 4. Update conflict_case
      await tx
        .update(conflictCases)
        .set({
          resolutionStatus: "user_overridden",
          winningObservationId: chosenObservationId,
          updatedAt: new Date(),
        })
        .where(eq(conflictCases.conflictId, conflictId));

      // 5. Mark derivation_results stale where any affected observation in input_observation_ids
      const allAffectedIds = [...otherObsIds, chosenObservationId];
      for (const obsId of allAffectedIds) {
        await tx.execute(
          sql`UPDATE derivation_result SET stale = true
              WHERE ${obsId} = ANY(input_observation_ids)`
        );
      }

      // 6. (notification handled after commit via publishNotification)

      // 7. Insert audit_log
      await tx.insert(auditLog).values({
        logId: uuidv7(),
        companyId: company_id,
        entityType: "conflict_case",
        entityId: conflictId,
        action: "resolve_override",
        actorId: user_id,
        metadata: {
          chosenObservationId,
          reason: reason ?? null,
          previousWinner: conflict.winningObservationId,
        },
      });

      return { conflictId, chosenObservationId };
    });

    if ("error" in result) {
      const code = result.error;
      const status = result.status as number;
      const message = (result as any).message ?? code;
      return NextResponse.json({ code, message }, { status });
    }

    // Publish notification after transaction commit
    await publishNotification(company_id, {
      type: "conflict_resolved",
      payload: {
        conflict_id: conflictId,
        chosen_observation_id: chosenObservationId,
        resolutionStatus: "user_overridden",
      },
    });

    return NextResponse.json({
      conflictId: result.conflictId,
      resolutionStatus: "user_overridden" as const,
      winningObservationId: result.chosenObservationId,
    });
  } catch (err) {
    console.error("[POST /api/conflicts/[id]/resolve] Error:", err);
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Internal server error" }, { status: 500 });
  }
}
