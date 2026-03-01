import { env } from "@/lib/env";

export interface EmbeddingBatchResult {
  blockIds: string[];
  vectors: number[][];
  failed: boolean;
  error: string | null;
}

const BATCH_SIZE = 512;

/**
 * Embeds text arrays with model text-embedding-3-small in batches of 512 max.
 * Returns 1536-d vectors and per-batch error envelopes so failed batches can be
 * marked embedding_status=failed without aborting the whole job.
 */
export async function embedTexts(
  inputs: Array<{ blockId: string; text: string }>
): Promise<EmbeddingBatchResult[]> {
  const results: EmbeddingBatchResult[] = [];

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const blockIds = batch.map((b) => b.blockId);
    const texts = batch.map((b) => b.text);

    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: texts,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        results.push({
          blockIds,
          vectors: [],
          failed: true,
          error: `OpenAI API error ${response.status}: ${errText}`,
        });
        continue;
      }

      const data = await response.json();
      const vectors = (data.data as Array<{ embedding: number[] }>)
        .sort((a: any, b: any) => a.index - b.index)
        .map((d: any) => d.embedding);

      results.push({
        blockIds,
        vectors,
        failed: false,
        error: null,
      });
    } catch (err) {
      results.push({
        blockIds,
        vectors: [],
        failed: true,
        error: err instanceof Error ? err.message : "Unknown embedding error",
      });
    }
  }

  return results;
}
