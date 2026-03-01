// MCP tool: merge_observations — Slice 5
// Bulk merge observation keys/labels.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations } from "@/lib/db/schema/observations";
import { auditLog } from "@/lib/db/schema/notifications";
import { eq, and, inArray } from "drizzle-orm";
import type { AgentContext } from "@/lib/mcp/index";

interface MergeObservationsInput {
  observation_ids: string[];
  canonical_label?: string;
  canonical_normalized_key?: string;
  canonical_unit?: string;
}

export async function mergeObservations(
  input: MergeObservationsInput,
  ctx: AgentContext
): Promise<{ updated_count: number }> {
  return await withTenant(db, ctx.companyId, async (tx) => {
    // Fetch approved observations in company scope
    const obs = await tx
      .select({
        observation_id: observations.observationId,
        label: observations.label,
        normalized_key: observations.normalizedKey,
        status: observations.status,
      })
      .from(observations)
      .where(
        and(
          eq(observations.companyId, ctx.companyId),
          inArray(observations.observationId, input.observation_ids),
          eq(observations.status, "approved")
        )
      );

    if (obs.length === 0) {
      return { updated_count: 0 };
    }

    const updateFields: Record<string, any> = {};
    if (input.canonical_label) updateFields.label = input.canonical_label;
    if (input.canonical_normalized_key) updateFields.normalizedKey = input.canonical_normalized_key;
    if (input.canonical_unit) updateFields.unit = input.canonical_unit;

    if (Object.keys(updateFields).length === 0) {
      return { updated_count: 0 };
    }

    updateFields.updatedAt = new Date();

    await tx
      .update(observations)
      .set(updateFields)
      .where(
        and(
          eq(observations.companyId, ctx.companyId),
          inArray(observations.observationId, input.observation_ids),
          eq(observations.status, "approved")
        )
      );

    // Write audit log entries
    for (const o of obs) {
      await tx.insert(auditLog).values({
        companyId: ctx.companyId,
        entityType: "observation",
        entityId: o.observation_id,
        action: "merge_update",
        actorId: ctx.userId,
        metadata: {
          previous_label: o.label,
          previous_key: o.normalized_key,
          ...updateFields,
        },
      });
    }

    return { updated_count: obs.length };
  });
}
