import { env } from "@/lib/env";

interface EquivalenceInput {
  keyA: string;
  labelA: string;
  unitA: string;
  keyB: string;
  labelB: string;
  unitB: string;
}

interface EquivalenceResult {
  result: "SAME_KEY" | "DIFFERENT_KEY";
  rationale: string;
}

/**
 * Grok-based normalized key equivalence classification for semantic conflict detection.
 * Calls grok-4-1-fast-reasoning with 30s timeout.
 * On malformed response, logs parse error and returns DIFFERENT_KEY conservatively.
 */
export async function callGrokEquivalence(input: EquivalenceInput): Promise<EquivalenceResult> {
  const prompt = `Are these two ESG observation keys referring to the same real-world metric?

Key A:
  - key: ${input.keyA}
  - label: ${input.labelA}
  - unit: ${input.unitA}

Key B:
  - key: ${input.keyB}
  - label: ${input.labelB}
  - unit: ${input.unitB}

Your response must start with exactly one of these tokens: SAME_KEY or DIFFERENT_KEY
Then provide your rationale on the next line.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown");
      throw new Error(`Grok API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";

    return parseEquivalenceResponse(content);
  } finally {
    clearTimeout(timeout);
  }
}

function parseEquivalenceResponse(content: string): EquivalenceResult {
  const trimmed = content.trim();
  const firstLine = trimmed.split("\n")[0]?.trim() ?? "";
  const restLines = trimmed.split("\n").slice(1).join("\n").trim();

  if (firstLine.startsWith("SAME_KEY")) {
    return { result: "SAME_KEY", rationale: restLines || firstLine };
  }

  if (firstLine.startsWith("DIFFERENT_KEY")) {
    return { result: "DIFFERENT_KEY", rationale: restLines || firstLine };
  }

  // Malformed response: log parse error and return DIFFERENT_KEY conservatively
  console.error("[equivalenceClassifier] Malformed response, treating as DIFFERENT_KEY", {
    firstTokenReceived: firstLine.slice(0, 50),
    fullContent: trimmed.slice(0, 200),
  });

  return { result: "DIFFERENT_KEY", rationale: `PARSE_ERROR: ${trimmed.slice(0, 200)}` };
}
