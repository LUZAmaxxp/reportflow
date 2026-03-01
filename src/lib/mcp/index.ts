// MCP registry and guarded dispatcher — Slice 5 §5.6-§5.7

import { searchObservations } from "@/lib/mcp/search-observations";
import { searchEvidence } from "@/lib/mcp/search-evidence";
import { computeDerivation } from "@/lib/mcp/compute-derivation";
import { proposeManualObservation } from "@/lib/mcp/propose-manual-observation";
import { createReport } from "@/lib/mcp/create-report";
import { renderPdf } from "@/lib/mcp/render-pdf";
import { getCategories } from "@/lib/mcp/get-categories";
import { mergeObservations } from "@/lib/mcp/merge-observations";
import { getReportData } from "@/lib/mcp/get-report-data";
import { getPreferences } from "@/lib/mcp/get-preferences";

export type AgentContext = { companyId: string; userId: string; sessionId: string; };

type ToolFn = (input: any, ctx: AgentContext) => Promise<any>;

const TOOL_REGISTRY: Record<string, ToolFn> = {
  search_observations: searchObservations,
  search_evidence: searchEvidence,
  compute_derivation: computeDerivation,
  propose_manual_observation: proposeManualObservation,
  create_report: createReport,
  render_pdf: renderPdf,
  get_categories: getCategories,
  merge_observations: mergeObservations,
  get_report_data: getReportData,
  get_preferences: getPreferences,
};

export async function toolDispatch(
  toolName: string,
  input: unknown,
  ctx: AgentContext
): Promise<{ result?: unknown; error?: string; retryable?: boolean }> {
  const fn = TOOL_REGISTRY[toolName];
  if (!fn) {
    return { error: "unknown_tool" };
  }

  try {
    const result = await fn(input, ctx);
    return { result };
  } catch (err: any) {
    const message = err?.message ?? "Tool execution failed";
    // Mark connection/timeout errors as retryable
    const retryable = !!(
      err?.code === "ECONNREFUSED" ||
      err?.code === "ECONNRESET" ||
      err?.code === "ETIMEDOUT" ||
      message.includes("timeout") ||
      message.includes("ECONNREFUSED")
    );
    console.error(`[MCP] Tool ${toolName} failed:`, message);
    return { error: message, retryable };
  }
}
