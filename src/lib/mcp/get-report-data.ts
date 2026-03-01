// MCP tool: get_report_data — Slice 5
// Load report plus linked observations and derivations.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { reports } from "@/lib/db/schema/reports";
import { observations } from "@/lib/db/schema/observations";
import { derivationResults } from "@/lib/db/schema/derivations";
import { eq, and, inArray } from "drizzle-orm";
import type { AgentContext } from "@/lib/mcp/index";

interface GetReportDataInput {
  report_id: string;
}

export async function getReportData(
  input: GetReportDataInput,
  ctx: AgentContext
): Promise<{ report: any; observations: any[]; derivations: any[] }> {
  return await withTenant(db, ctx.companyId, async (tx) => {
    // Load report
    const [report] = await tx
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.reportId, input.report_id),
          eq(reports.companyId, ctx.companyId)
        )
      )
      .limit(1);

    if (!report) {
      throw new Error("Report not found in company scope");
    }

    // Load linked observations
    const obs = report.observationIds.length > 0
      ? await tx
          .select()
          .from(observations)
          .where(
            and(
              eq(observations.companyId, ctx.companyId),
              inArray(observations.observationId, report.observationIds)
            )
          )
      : [];

    // Load linked derivation results
    const derivations = report.derivationResultIds.length > 0
      ? await tx
          .select()
          .from(derivationResults)
          .where(
            and(
              eq(derivationResults.companyId, ctx.companyId),
              inArray(derivationResults.resultId, report.derivationResultIds)
            )
          )
      : [];

    return {
      report: {
        report_id: report.reportId,
        version: report.version,
        status: report.status,
        language: report.language,
        source_report_id: report.sourceReportId,
        generated_at: report.generatedAt?.toISOString?.() ?? report.generatedAt,
      },
      observations: obs.map((o: typeof obs[number]) => ({
        observation_id: o.observationId,
        label: o.label,
        normalized_key: o.normalizedKey,
        value: o.value,
        unit: o.unit,
        data_type: o.dataType,
        period_start: o.periodStart,
        period_end: o.periodEnd,
        status: o.status,
      })),
      derivations: derivations.map((d: typeof derivations[number]) => ({
        derivation_result_id: d.resultId,
        operation: d.operation,
        result_value: d.resultValue,
        unit: d.unit,
        coverage: d.coverage,
        stale: d.stale,
      })),
    };
  });
}
