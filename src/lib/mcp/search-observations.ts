// MCP tool: search_observations — Slice 5 §5.6
// Input { query, filters? }. Output { observations }.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations } from "@/lib/db/schema/observations";
import { eq, and, gte, lte, ilike, sql } from "drizzle-orm";
import type { AgentContext } from "@/lib/mcp/index";

interface SearchObservationsInput {
  query: string;
  filters?: {
    category_id?: string;
    normalized_key?: string;
    period_start?: string;
    period_end?: string;
    status?: string;
  };
}

export async function searchObservations(
  input: SearchObservationsInput,
  ctx: AgentContext
): Promise<{ observations: any[] }> {
  const result = await withTenant(db, ctx.companyId, async (tx) => {
    const conditions: any[] = [eq(observations.companyId, ctx.companyId)];

    if (input.filters?.status) {
      conditions.push(eq(observations.status, input.filters.status as any));
    } else {
      // Default to approved observations for agent reasoning
      conditions.push(eq(observations.status, "approved"));
    }

    if (input.filters?.category_id) {
      conditions.push(eq(observations.categoryId, input.filters.category_id));
    }

    if (input.filters?.normalized_key) {
      conditions.push(eq(observations.normalizedKey, input.filters.normalized_key));
    }

    if (input.filters?.period_start) {
      conditions.push(gte(observations.periodEnd, input.filters.period_start));
    }

    if (input.filters?.period_end) {
      conditions.push(lte(observations.periodStart, input.filters.period_end));
    }

    if (input.query) {
      conditions.push(
        sql`(${observations.label} ILIKE ${"%" + input.query + "%"} OR ${observations.normalizedKey} ILIKE ${"%" + input.query + "%"})`
      );
    }

    const rows = await tx
      .select({
        observation_id: observations.observationId,
        label: observations.label,
        normalized_key: observations.normalizedKey,
        value: observations.value,
        unit: observations.unit,
        data_type: observations.dataType,
        time_behavior: observations.timeBehavior,
        period_start: observations.periodStart,
        period_end: observations.periodEnd,
        status: observations.status,
        category_id: observations.categoryId,
        confidence_score: observations.confidenceScore,
      })
      .from(observations)
      .where(and(...conditions))
      .limit(100);

    return rows;
  });

  return { observations: result };
}
