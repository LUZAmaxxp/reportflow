import { and, eq, sql, gte, lte } from "drizzle-orm";
import { observations } from "@/lib/db/schema/observations";
import { conflictCases } from "@/lib/db/schema/conflicts";

/**
 * Exact-match conflict detection helper run after candidate insert.
 * For each new observation, queries approved observations in same company
 * with identical normalized_key and overlapping period window.
 * Inserts conflict_case rows for later resolution (Slice 4).
 */

export interface NewObservationRef {
  observationId: string;
  normalizedKey: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface ExactConflictResult {
  conflictsCreated: number;
}

/**
 * Creates exact-match conflict_case rows against approved observations.
 * Leaves observation statuses unchanged — this is flag-only conflict creation.
 */
export async function createExactConflicts(
  tx: any,
  companyId: string,
  newObservations: NewObservationRef[]
): Promise<ExactConflictResult> {
  let conflictsCreated = 0;

  for (const newObs of newObservations) {
    // Skip if no period info
    if (!newObs.periodStart || !newObs.periodEnd) continue;

    // Step 15: Query approved observations with same key and overlapping period
    const matchedApproved = await tx
      .select({
        observationId: observations.observationId,
        periodStart: observations.periodStart,
        periodEnd: observations.periodEnd,
      })
      .from(observations)
      .where(
        and(
          eq(observations.companyId, companyId),
          eq(observations.normalizedKey, newObs.normalizedKey),
          eq(observations.status, "approved"),
          // Period overlap: approved.period_start <= newPeriodEnd AND approved.period_end >= newPeriodStart
          lte(observations.periodStart, newObs.periodEnd),
          gte(observations.periodEnd, newObs.periodStart)
        )
      );

    // Step 16: Insert conflict_case for each exact match
    for (const matched of matchedApproved) {
      // SPEC DEVIATION: Exact conflict insertion marks resolution_status auto_resolved
      // while also setting auto_resolved=false and no winner; this is retained verbatim
      // from plan and interpreted as pre-classification placeholder pending Slice 4 user review.
      await tx.insert(conflictCases).values({
        companyId,
        normalizedKey: newObs.normalizedKey,
        conflictGroupId: sql`gen_random_uuid()`,
        matchMethod: "exact",
        periodStart: newObs.periodStart,
        periodEnd: newObs.periodEnd,
        observationIds: [newObs.observationId, matched.observationId],
        winningObservationId: null,
        autoResolved: false,
        resolutionStatus: "auto_resolved",
      });
      conflictsCreated++;
    }
  }

  return { conflictsCreated };
}
