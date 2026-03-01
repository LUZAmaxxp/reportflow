// MCP tool: compute_derivation — Slice 5 §5.7
// Compute or reuse derivation results with coverage semantics.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations } from "@/lib/db/schema/observations";
import { derivationResults } from "@/lib/db/schema/derivations";
import { eq, and, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import type { AgentContext } from "@/lib/mcp/index";

type Period = { type: "FY" | "Q" | "YTD" | "custom"; start_date: string; end_date: string; label?: string };
type ComputeDerivationInput = { observation_ids: string[]; operation: "sum" | "average" | "delta" | "ratio" | "count"; expected_periods?: Period[] };
type Coverage = { present_periods: Period[]; expected_periods: Period[]; fraction: number | null };
type ComputeDerivationOutput = { derivation_result_id: string; value: number; unit: string; coverage: Coverage; input_observation_ids: string[]; status: "fresh" | "reused"; stale: boolean; insufficient_coverage: boolean };

export async function computeDerivation(
  input: ComputeDerivationInput,
  ctx: AgentContext
): Promise<ComputeDerivationOutput> {
  const { observation_ids, operation, expected_periods } = input;

  // Generate fingerprint for caching
  const sortedIds = [...observation_ids].sort();
  const fingerprintInput = JSON.stringify(sortedIds) + operation + ctx.companyId;
  const fingerprintHash = createHash("sha256").update(fingerprintInput).digest("hex");

  return await withTenant(db, ctx.companyId, async (tx) => {
    // Check for existing cached result
    const [existing] = await tx
      .select()
      .from(derivationResults)
      .where(
        and(
          eq(derivationResults.companyId, ctx.companyId),
          eq(derivationResults.fingerprintHash, fingerprintHash)
        )
      )
      .limit(1);

    if (existing) {
      return {
        derivation_result_id: existing.resultId,
        value: parseFloat(existing.resultValue),
        unit: existing.unit,
        coverage: existing.coverage as Coverage,
        input_observation_ids: existing.inputObservationIds,
        status: "reused" as const,
        stale: existing.stale,
        insufficient_coverage: (existing.coverage as Coverage).fraction !== null && (existing.coverage as Coverage).fraction! < 0.5,
      };
    }

    // Validate all observations are approved and owned
    const obs = await tx
      .select({
        observation_id: observations.observationId,
        value: observations.value,
        numeric_value: observations.numericValue,
        unit: observations.unit,
        data_type: observations.dataType,
        period_start: observations.periodStart,
        period_end: observations.periodEnd,
        status: observations.status,
      })
      .from(observations)
      .where(
        and(
          eq(observations.companyId, ctx.companyId),
          inArray(observations.observationId, observation_ids)
        )
      );

    // Validate all found and approved
    if (obs.length !== observation_ids.length) {
      throw new Error("Some observation_ids not found in company scope");
    }

    const nonApproved = obs.filter((o: typeof obs[number]) => o.status !== "approved");
    if (nonApproved.length > 0) {
      throw new Error("All observations must be approved for derivation");
    }

    // Extract numeric values
    const numericValues = obs.map((o: typeof obs[number]) => {
      const val = o.numeric_value ? parseFloat(o.numeric_value) : parseFloat(o.value);
      if (isNaN(val)) throw new Error(`Observation ${o.observation_id} has non-numeric value`);
      return val;
    });

    // Compute
    let resultValue: number;
    switch (operation) {
      case "sum":
        resultValue = numericValues.reduce((a: number, b: number) => a + b, 0);
        break;
      case "average":
        resultValue = numericValues.reduce((a: number, b: number) => a + b, 0) / numericValues.length;
        break;
      case "delta":
        if (numericValues.length < 2) throw new Error("Delta requires at least 2 observations");
        resultValue = numericValues[numericValues.length - 1] - numericValues[0];
        break;
      case "ratio":
        if (numericValues.length !== 2) throw new Error("Ratio requires exactly 2 observations");
        if (numericValues[1] === 0) throw new Error("Division by zero in ratio operation");
        resultValue = numericValues[0] / numericValues[1];
        break;
      case "count":
        resultValue = numericValues.length;
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    // Unit compatibility — use first observation's unit
    const unit = obs[0].unit || "";

    // Compute coverage
    const presentPeriods: Period[] = obs
      .filter((o: typeof obs[number]) => o.period_start && o.period_end)
      .map((o: typeof obs[number]) => ({
        type: "custom" as const,
        start_date: o.period_start!,
        end_date: o.period_end!,
      }));

    const coverage: Coverage = {
      present_periods: presentPeriods,
      expected_periods: expected_periods ?? [],
      fraction: expected_periods
        ? expected_periods.length > 0
          ? presentPeriods.length / expected_periods.length
          : null
        : null,
    };

    // Enforce insufficient coverage signaling below 0.50
    const insufficientCoverage = coverage.fraction !== null && coverage.fraction < 0.5;
    if (insufficientCoverage) {
      console.warn(`[compute_derivation] Insufficient coverage: ${coverage.fraction}`);
    }

    // Persist result
    const [inserted] = await tx
      .insert(derivationResults)
      .values({
        companyId: ctx.companyId,
        operation,
        resultValue: resultValue.toString(),
        unit,
        inputObservationIds: observation_ids,
        coverage: coverage as any,
        fingerprintHash,
        stale: false,
      })
      .returning({
        resultId: derivationResults.resultId,
      });

    return {
      derivation_result_id: inserted.resultId,
      value: resultValue,
      unit,
      coverage,
      input_observation_ids: observation_ids,
      status: "fresh" as const,
      stale: false,
      insufficient_coverage: insufficientCoverage,
    };
  });
}
