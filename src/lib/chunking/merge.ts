import type { ParsedBlock } from "@/lib/ocr/parse";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import { uuidv7 } from "uuidv7";

export interface ChunkingResult {
  blocksToInsert: ParsedBlock[];
  supersededMap: Record<string, string[]>;
}

/**
 * Fraction of page height within which two blocks are considered on the same row.
 * PP-OCRv5 text lines on the same table row will have y-centers within ~1% of each other.
 */
const ROW_Y_TOLERANCE = 0.012;

/**
 * Row-only merge for PP-OCRv5 per-line blocks.
 *
 * PP-OCRv5 returns individual text cells (e.g. "Combustion fixe", "8 450", "11,9%", "1"
 * as separate blocks). We group cells on the same horizontal band into one row block
 * (e.g. "Combustion fixe | 8 450 | 11,9% | 1") so the LLM has tabular context.
 *
 * We do NOT merge across rows — each row stays its own block. This ensures each
 * observation maps to a specific row with a precise bbox.
 */
export function mergeAdjacentBlocks(blocks: ParsedBlock[]): ChunkingResult {
  if (blocks.length === 0) return { blocksToInsert: [], supersededMap: {} };

  const result: ParsedBlock[] = [];
  const supersededMap: Record<string, string[]> = {};

  // Group blocks by page
  const pageMap = new Map<number, ParsedBlock[]>();
  for (const block of blocks) {
    const list = pageMap.get(block.pageNumber) ?? [];
    list.push(block);
    pageMap.set(block.pageNumber, list);
  }

  for (const [_page, pageBlocks] of pageMap) {
    // Sort by vertical center
    const sorted = [...pageBlocks].sort((a, b) => {
      const aCy = (a.bbox[1] + a.bbox[3]) / 2;
      const bCy = (b.bbox[1] + b.bbox[3]) / 2;
      return aCy - bCy;
    });

    // Group into rows: blocks whose y-centers are within ROW_Y_TOLERANCE
    const rows: ParsedBlock[][] = [];
    let currentRow: ParsedBlock[] = [];
    let currentRowYCenter = -1;

    for (const block of sorted) {
      const yCenter = (block.bbox[1] + block.bbox[3]) / 2;

      if (currentRow.length === 0) {
        currentRow.push(block);
        currentRowYCenter = yCenter;
      } else if (Math.abs(yCenter - currentRowYCenter) <= ROW_Y_TOLERANCE) {
        currentRow.push(block);
      } else {
        rows.push(currentRow);
        currentRow = [block];
        currentRowYCenter = yCenter;
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);

    // Merge each row's cells left-to-right
    for (const row of rows) {
      if (row.length === 1) {
        // Single-cell row — keep as-is
        result.push(row[0]);
        continue;
      }

      // Sort cells left-to-right within the row
      row.sort((a, b) => a.bbox[0] - b.bbox[0]);

      const mergedText = row.map((b) => b.text).join(" | ");
      const mergedBbox: [number, number, number, number] = [
        Math.min(...row.map((b) => b.bbox[0])),
        Math.min(...row.map((b) => b.bbox[1])),
        Math.max(...row.map((b) => b.bbox[2])),
        Math.max(...row.map((b) => b.bbox[3])),
      ];

      const mergedBlockId = uuidv7();
      const originalIds = row.map((b) => b.tempId);

      // Mark originals as superseded
      for (const block of row) {
        result.push({ ...block, chunkType: "superseded" as const });
        supersededMap[block.tempId] = [mergedBlockId];
      }

      // Create merged row block
      const avgConfidence =
        row.reduce((sum, b) => sum + b.ocrConfidence, 0) / row.length;

      result.push({
        tempId: mergedBlockId,
        pageNumber: row[0].pageNumber,
        bbox: mergedBbox,
        text: mergedText,
        blockType: "paragraph",
        ocrConfidence: avgConfidence,
        lowConfidence: avgConfidence < LOW_CONFIDENCE_THRESHOLD,
        chunkType: "merged",
        mergedBlockIds: originalIds,
        parentBlockId: null,
      });
    }
  }

  return { blocksToInsert: result, supersededMap };
}
