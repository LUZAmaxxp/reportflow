// MCP tool: search_evidence — Slice 5 §5.6
// Hybrid retrieval for evidence blocks. Reuses Slice 3 dense+sparse RRF.
// Input { query, filters? }. Output blocks with block_id, document_version_id, page_number, bbox, text, document_title, category_path, score.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { documentVersions, documents } from "@/lib/db/schema/documents";
import { eq, and, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import {
  RRF_DENSE_WEIGHT,
  RRF_SPARSE_WEIGHT,
  RRF_K,
  ESG_KEYWORD_BAG,
} from "@/lib/extraction/hybridRetrieval";
import type { AgentContext } from "@/lib/mcp/index";

interface SearchEvidenceInput {
  query: string;
  filters?: {
    document_version_id?: string;
    category_id?: string;
  };
}

interface EvidenceBlock {
  block_id: string;
  document_version_id: string;
  page_number: number;
  bbox: any;
  text: string;
  document_title: string;
  category_path: string | null;
  score: number;
}

/**
 * Generate query embedding using OpenAI text-embedding-3-small.
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
    throw new Error(`OpenAI embedding failed: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

export async function searchEvidence(
  input: SearchEvidenceInput,
  ctx: AgentContext
): Promise<{ blocks: EvidenceBlock[] }> {
  const result = await withTenant(db, ctx.companyId, async (tx) => {
    const queryVector = await getQueryEmbedding(input.query);
    const vectorStr = `[${queryVector.join(",")}]`;

    await tx.execute(sql.raw("SET LOCAL hnsw.ef_search = 100"));

    // Build document version filter condition
    let versionFilter = sql`dv.company_id = ${ctx.companyId}`;
    if (input.filters?.document_version_id) {
      versionFilter = sql`dv.company_id = ${ctx.companyId} AND dv.document_version_id = ${input.filters.document_version_id}`;
    }

    // Dense retrieval
    const denseRows: any[] = await tx.execute(
      sql`SELECT
        eb.block_id, eb.document_version_id, eb.page_number, eb.bbox, eb.text
      FROM evidence_block eb
      JOIN document_version dv ON dv.document_version_id = eb.document_version_id
      WHERE ${versionFilter}
        AND eb.embedding_status = 'completed'
      ORDER BY eb.embedding <=> ${vectorStr}::vector
      LIMIT 100`
    );

    const dense = Array.isArray(denseRows) ? denseRows : (denseRows as any).rows ?? [];

    // Sparse retrieval
    const sparseRows: any[] = await tx.execute(
      sql`SELECT
        eb.block_id, eb.document_version_id, eb.page_number, eb.bbox, eb.text,
        similarity(eb.text, ${input.query || ESG_KEYWORD_BAG}) as trgm_score
      FROM evidence_block eb
      JOIN document_version dv ON dv.document_version_id = eb.document_version_id
      WHERE ${versionFilter}
      ORDER BY similarity(eb.text, ${input.query || ESG_KEYWORD_BAG}) DESC
      LIMIT 100`
    );

    const sparse = Array.isArray(sparseRows) ? sparseRows : (sparseRows as any).rows ?? [];

    // RRF fusion
    const denseRankMap = new Map<string, number>();
    dense.forEach((row: any, idx: number) => denseRankMap.set(row.block_id, idx + 1));

    const sparseRankMap = new Map<string, number>();
    sparse.forEach((row: any, idx: number) => sparseRankMap.set(row.block_id, idx + 1));

    const allBlockIds = new Set<string>();
    const blockDataMap = new Map<string, any>();

    for (const row of dense) {
      allBlockIds.add(row.block_id);
      blockDataMap.set(row.block_id, row);
    }
    for (const row of sparse) {
      allBlockIds.add(row.block_id);
      if (!blockDataMap.has(row.block_id)) {
        blockDataMap.set(row.block_id, row);
      }
    }

    const denseN = dense.length;
    const sparseN = sparse.length;

    const fused: Array<{ blockId: string; score: number }> = [];
    for (const blockId of allBlockIds) {
      const denseRank = denseRankMap.get(blockId) ?? denseN + 1;
      const sparseRank = sparseRankMap.get(blockId) ?? sparseN + 1;
      const score =
        RRF_DENSE_WEIGHT * (1 / (RRF_K + denseRank)) +
        RRF_SPARSE_WEIGHT * (1 / (RRF_K + sparseRank));
      fused.push({ blockId, score });
    }

    fused.sort((a, b) => b.score - a.score);
    const topK = fused.slice(0, 50);

    // Fetch document titles for results
    const blockIds = topK.map((f) => f.blockId);
    if (blockIds.length === 0) return [];

    const docVersionIds = [...new Set(topK.map((f) => blockDataMap.get(f.blockId)?.document_version_id).filter(Boolean))];
    const docInfoRows: any[] = docVersionIds.length > 0
      ? await tx.execute(
          sql`SELECT dv.document_version_id, d.title, d.category_id
            FROM document_version dv
            JOIN document d ON d.document_id = dv.document_id
            WHERE dv.document_version_id = ANY(ARRAY[${sql.join(docVersionIds.map((id) => sql`${id}::uuid`), sql`, `)}])`
        )
      : [];
    const docInfo = Array.isArray(docInfoRows) ? docInfoRows : (docInfoRows as any).rows ?? [];
    const docInfoMap = new Map<string, { title: string; category_path: string | null }>();
    for (const row of docInfo) {
      docInfoMap.set(row.document_version_id, {
        title: row.title ?? "",
        category_path: null,
      });
    }

    return topK.map((f) => {
      const data = blockDataMap.get(f.blockId)!;
      const info = docInfoMap.get(data.document_version_id) ?? { title: "", category_path: null };
      return {
        block_id: f.blockId,
        document_version_id: data.document_version_id,
        page_number: data.page_number,
        bbox: data.bbox,
        text: data.text,
        document_title: info.title,
        category_path: info.category_path,
        score: f.score,
      };
    });
  });

  return { blocks: result };
}
