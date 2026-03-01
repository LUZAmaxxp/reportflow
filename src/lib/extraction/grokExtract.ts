import { env } from "@/lib/env";
import type { RetrievedBlock } from "./hybridRetrieval";

/**
 * Wrapper around xAI Grok extraction inference call.
 * Builds prompt, calls grok-4-1-fast-reasoning in JSON mode, retries once for schema-invalid response.
 */

export interface GrokExtractionResult {
  success: boolean;
  rawJson: unknown;
  error: string | null;
  retried: boolean;
}

interface GrokExtractionContext {
  filename: string;
  category: string | null;
  client: string | null;
  blocks: RetrievedBlock[];
  softKeyHints?: string[];
}

const GROK_CALL_TIMEOUT = 120000;
const MAX_TOTAL_ELAPSED = 240000;
const JOB_TIMEOUT_BUDGET = 300000;

/**
 * Extracts an array from a Grok JSON response object.
 * Handles: direct array, { observations: [...] }, { data: [...] }, or any top-level array value.
 */
function extractArrayFromResponse(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;

  // Try known keys first
  for (const key of ["observations", "data", "results", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }

  // Fall back to first array value found
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) return value;
  }

  return null;
}

function buildExtractionPrompt(context: GrokExtractionContext): { system: string; user: string } {
  const blockList = context.blocks
    .map(
      (b, i) =>
        `[${i + 1}] block_id=${b.blockId} page=${b.pageNumber}\n${b.text}`
    )
    .join("\n\n");

  const keyHintSection = context.softKeyHints?.length
    ? `\nSoft key hints (use as guidance, not mandatory): ${context.softKeyHints.join(", ")}`
    : "";

  const system = `You are an ESG data extraction expert. Extract structured observations from the provided document evidence blocks.

Output a valid JSON object with a single key "observations" containing an array of observation objects.

Schema:
{"observations": [
  {
    "label": "string (max 200 chars, human-readable FR/EN label)",
    "normalized_key": "string (lowercase snake_case, e.g. co2_emissions_scope1)",
    "value": "string (the extracted value as text)",
    "numeric_value": 123.45 or null,
    "unit": "string or null (e.g. tCO2e, MWh, %)",
    "data_type": "numeric" | "percentage" | "text" | "boolean",
    "time_behavior": "periodic" | "point_in_time" | "none",
    "period_start": "YYYY-MM-DD" or null,
    "period_end": "YYYY-MM-DD" or null,
    "evidence_block_ids": ["<block_id_uuid>"] (non-empty, MUST only use block_ids from the provided list),
    "confidence_score": 0.0 to 1.0
  }
]}

Rules:
- evidence_block_ids MUST contain the exact block_id UUID strings from the evidence blocks above. Copy them verbatim — do NOT modify, truncate, or invent block_ids.
- Each observation's evidence_block_ids should reference the specific block(s) where that data appears. Do NOT assign all observations to the same block.
- For numeric or percentage data_type, numeric_value MUST be a number (not null).
- normalized_key must match: lowercase letters, digits, underscores only, starting with a letter.
- confidence_score reflects your certainty in the extraction.
- If both period_start and period_end are provided, period_end >= period_start.
- Do NOT create observations for data not present in the evidence blocks.
- If no ESG-relevant data is found, return {"observations": []}.`;

  const user = `Document: ${context.filename}
Category: ${context.category ?? "unknown"}
Client: ${context.client ?? "unknown"}
${keyHintSection}

Evidence blocks:
${blockList}

Extract all ESG-relevant observations from these evidence blocks. Return a JSON object with key "observations" containing the array.`;

  return { system, user };
}

/**
 * Calls xAI Grok model for extraction.
 * Retries once only for schema-invalid response; skips retry when elapsed>=240000 ms.
 */
export async function grokExtract(
  context: GrokExtractionContext,
  startTime: number = Date.now()
): Promise<GrokExtractionResult> {
  const { system, user } = buildExtractionPrompt(context);

  const callGrok = async (): Promise<{ rawJson: unknown; parseError: boolean }> => {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(GROK_CALL_TIMEOUT),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Grok API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Grok response missing content");
    }

    try {
      const parsed = JSON.parse(content);
      // Extract the array from various possible response shapes
      const rawJson = extractArrayFromResponse(parsed);
      if (!rawJson) {
        console.warn("[GrokExtract] Could not find array in response. Keys:", typeof parsed === 'object' && parsed ? Object.keys(parsed) : typeof parsed);
        return { rawJson: parsed, parseError: true };
      }
      return { rawJson, parseError: false };
    } catch {
      console.warn("[GrokExtract] Failed to parse JSON content:", content?.slice(0, 200));
      return { rawJson: content, parseError: true };
    }
  };

  try {
    const firstResult = await callGrok();

    if (!firstResult.parseError) {
      return {
        success: true,
        rawJson: firstResult.rawJson,
        error: null,
        retried: false,
      };
    }

    // Check if we have budget for retry
    const elapsed = Date.now() - startTime;
    if (elapsed >= MAX_TOTAL_ELAPSED) {
      return {
        success: false,
        rawJson: firstResult.rawJson,
        error: `Schema-invalid response, no retry budget (elapsed ${elapsed}ms >= ${MAX_TOTAL_ELAPSED}ms)`,
        retried: false,
      };
    }

    // Retry once for schema-invalid response
    console.warn("[GrokExtract] First response schema-invalid, retrying...");
    const retryResult = await callGrok();

    if (!retryResult.parseError) {
      return {
        success: true,
        rawJson: retryResult.rawJson,
        error: null,
        retried: true,
      };
    }

    return {
      success: false,
      rawJson: retryResult.rawJson,
      error: "Schema-invalid response after retry",
      retried: true,
    };
  } catch (err) {
    return {
      success: false,
      rawJson: null,
      error: err instanceof Error ? err.message : "Unknown Grok extraction error",
      retried: false,
    };
  }
}
