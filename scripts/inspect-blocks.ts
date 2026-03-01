import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const dvId = process.argv[2] || "e87beaf2-db62-4549-8f42-1795760bf4a1";

  const r: any = await db.execute(sql`
    SELECT block_id, page_number, block_type, chunk_type, embedding_status, low_confidence, ocr_confidence,
           length(text) as text_len, left(text, 200) as text_preview
    FROM evidence_block
    WHERE document_version_id = ${dvId}
    ORDER BY page_number, block_id
  `);
  const rows = Array.isArray(r) ? r : (r as any).rows ?? [];
  for (const row of rows) {
    console.log("---");
    console.log(`page: ${row.page_number} | type: ${row.block_type} | chunk: ${row.chunk_type}`);
    console.log(`embedding: ${row.embedding_status} | conf: ${row.ocr_confidence} | low: ${row.low_confidence}`);
    console.log(`text (${row.text_len} chars): ${row.text_preview}`);
  }
  console.log(`\nTotal blocks: ${rows.length}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
