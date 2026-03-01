import { sql } from "drizzle-orm";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { eq, and } from "drizzle-orm";
import { env } from "@/lib/env";

/**
 * Hybrid retrieval for one document version.
 * Dense (pgvector cosine) + Sparse (pg_trgm similarity) with RRF fusion.
 */

// SPEC DEVIATION: Spec §9.3 calls for BM25; implementation uses pg_trgm similarity
// to avoid external search engine and keep MVP stack simpler while retaining acceptable bilingual keyword recall.

export const EXTRACTION_QUERY_STRING =
  "ESG environmental social governance metrics emissions energy water waste employees training accidents gender pay supply chain governance board";

export const ESG_KEYWORD_BAG =
  "GES émissions scope CO2 énergie eau déchets employés formation accidents genre gouvernance conseil administrateurs fournisseurs achats responsable";

export const RRF_DENSE_WEIGHT = 0.6;
export const RRF_SPARSE_WEIGHT = 0.4;
export const RRF_K = 60;
export const HYBRID_TOP_K = 150;
export const MIN_BLOCKS_FOR_EXTRACTION = 3;
export const HNSW_EF_SEARCH_EXTRACTION = 100;

export interface RetrievedBlock {
  blockId: string;
  pageNumber: number;
  text: string;
  fusedScore: number;
}

/**
 * Generates a query embedding using OpenAI text-embedding-3-small.
 */
async function getQueryEmbedding(queryText: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: queryText,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`OpenAI query embedding failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Performs hybrid retrieval (dense + sparse) with RRF fusion for a document version.
 * Returns top HYBRID_TOP_K fused blocks.
 */
export async function hybridRetrieval(
  tx: any,
  documentVersionId: string
): Promise<RetrievedBlock[]> {
  // Step 5: Generate query embedding
  const queryVector = await getQueryEmbedding(EXTRACTION_QUERY_STRING);
  const vectorStr = `[${queryVector.join(",")}]`;

  // Set HNSW ef_search for extraction query quality
  await tx.execute(sql.raw(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH_EXTRACTION}`));

  // Step 6: Dense retrieval - pgvector cosine top-200
  const denseResults: Array<{ block_id: string; page_number: number; text: string }> = await tx.execute(
    sql`SELECT
      ${evidenceBlocks.blockId} as block_id,
      ${evidenceBlocks.pageNumber} as page_number,
      ${evidenceBlocks.text} as text
    FROM ${evidenceBlocks}
    WHERE ${evidenceBlocks.documentVersionId} = ${documentVersionId}
      AND ${evidenceBlocks.embeddingStatus} = 'completed'
    ORDER BY ${evidenceBlocks.embedding} <=> ${vectorStr}::vector
    LIMIT 200`
  );

  const denseRows = Array.isArray(denseResults) ? denseResults : (denseResults as any).rows ?? [];

  console.log(`[HybridRetrieval] Dense leg returned ${denseRows.length} blocks (embeddingStatus=completed)`);

  // Step 7: Sparse retrieval - pg_trgm similarity top-200
  const sparseResults = await tx.execute(
    sql`SELECT
      ${evidenceBlocks.blockId} as block_id,
      ${evidenceBlocks.pageNumber} as page_number,
      ${evidenceBlocks.text} as text,
      similarity(${evidenceBlocks.text}, ${ESG_KEYWORD_BAG}) as trgm_score
    FROM ${evidenceBlocks}
    WHERE ${evidenceBlocks.documentVersionId} = ${documentVersionId}
    ORDER BY similarity(${evidenceBlocks.text}, ${ESG_KEYWORD_BAG}) DESC
    LIMIT 200`
  );

  const sparseRows = Array.isArray(sparseResults) ? sparseResults : (sparseResults as any).rows ?? [];

  console.log(`[HybridRetrieval] Sparse leg returned ${sparseRows.length} blocks (no embedding filter)`);

  // Step 8: RRF fusion
  // Build rank maps
  const denseRankMap = new Map<string, number>();
  denseRows.forEach((row: any, index: number) => {
    denseRankMap.set(row.block_id, index + 1);
  });

  const sparseRankMap = new Map<string, number>();
  sparseRows.forEach((row: any, index: number) => {
    sparseRankMap.set(row.block_id, index + 1);
  });

  // Collect all unique block ids
  const allBlockIds = new Set<string>();
  const blockDataMap = new Map<string, { pageNumber: number; text: string }>();

  for (const row of denseRows) {
    allBlockIds.add(row.block_id);
    blockDataMap.set(row.block_id, { pageNumber: row.page_number, text: row.text });
  }
  for (const row of sparseRows) {
    allBlockIds.add(row.block_id);
    if (!blockDataMap.has(row.block_id)) {
      blockDataMap.set(row.block_id, { pageNumber: row.page_number, text: row.text });
    }
  }

  const denseN = denseRows.length;
  const sparseN = sparseRows.length;

  // Compute RRF scores
  const fusedScores: Array<{ blockId: string; score: number }> = [];
  for (const blockId of allBlockIds) {
    const denseRank = denseRankMap.get(blockId) ?? denseN + 1;
    const sparseRank = sparseRankMap.get(blockId) ?? sparseN + 1;

    const score =
      RRF_DENSE_WEIGHT * (1 / (RRF_K + denseRank)) +
      RRF_SPARSE_WEIGHT * (1 / (RRF_K + sparseRank));

    fusedScores.push({ blockId, score });
  }

  // Sort by fused score descending and take top HYBRID_TOP_K
  fusedScores.sort((a, b) => b.score - a.score);
  const topK = fusedScores.slice(0, HYBRID_TOP_K);

  console.log(`[HybridRetrieval] RRF fusion: ${allBlockIds.size} unique blocks → returning top ${topK.length}`);

  return topK.map((item) => {
    const data = blockDataMap.get(item.blockId)!;
    return {
      blockId: item.blockId,
      pageNumber: data.pageNumber,
      text: data.text,
      fusedScore: item.score,
    };
  });
}
