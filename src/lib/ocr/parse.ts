import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/constants";
import type { PaddleOCRBox } from "@/lib/ocr/paddleocr";
import { uuidv7 } from "uuidv7";

export interface ParsedBlock {
  tempId: string;
  pageNumber: number;
  bbox: [number, number, number, number];
  text: string;
  blockType: "paragraph" | "table_cell" | "header" | "list_item" | "figure_caption" | "other";
  ocrConfidence: number;
  lowConfidence: boolean;
  chunkType: "original" | "merged" | "split" | "superseded";
  mergedBlockIds: string[] | null;
  parentBlockId: string | null;
}

/**
 * Classify block type by heuristic based on text content and position.
 */
function classifyBlockType(text: string, bbox: [number, number, number, number]): ParsedBlock["blockType"] {
  const trimmed = text.trim();

  // Simple heuristics
  if (trimmed.length === 0) return "other";

  // Table cells tend to be small boxes with numbers/short text
  const bboxWidth = bbox[2] - bbox[0];
  const bboxHeight = bbox[3] - bbox[1];

  if (bboxWidth < 0.15 && bboxHeight < 0.05) {
    return "table_cell";
  }

  // Headers: short text, relatively large font (wider box relative to height)
  if (trimmed.length < 100 && bboxWidth > 0.3 && bboxHeight < 0.05) {
    return "header";
  }

  // List items start with bullet or number
  if (/^(\d+[\.\)]\s|[-•●]\s)/.test(trimmed)) {
    return "list_item";
  }

  // Figure captions
  if (/^(figure|fig\.|illustration|image)\s/i.test(trimmed)) {
    return "figure_caption";
  }

  return "paragraph";
}

/**
 * Normalizes pixel bbox to [0,1] ratios.
 */
function normalizeBbox(
  box: number[][],
  pageWidth: number,
  pageHeight: number
): [number, number, number, number] {
  if (!box || box.length < 4) return [0, 0, 1, 1];

  // PaddleOCR returns 4 corner points [tl, tr, br, bl]
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);

  const x1 = Math.max(0, Math.min(...xs) / (pageWidth || 1));
  const y1 = Math.max(0, Math.min(...ys) / (pageHeight || 1));
  const x2 = Math.min(1, Math.max(...xs) / (pageWidth || 1));
  const y2 = Math.min(1, Math.max(...ys) / (pageHeight || 1));

  return [
    Math.max(0, Math.min(1, x1)),
    Math.max(0, Math.min(1, y1)),
    Math.max(0, Math.min(1, x2)),
    Math.max(0, Math.min(1, y2)),
  ];
}

/**
 * Maps OCR boxes/text/scores arrays into ParsedBlock records.
 * Normalizes pixel bbox to [0,1] ratios, clamps bounds,
 * assigns block_type by heuristic, and computes low_confidence flag.
 *
 * PP-OCRv5 returns per-line text blocks, so no table splitting is needed.
 */
export function parseOCRResponse(
  ocrBoxes: PaddleOCRBox[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number
): ParsedBlock[] {
  const results: ParsedBlock[] = [];

  for (const box of ocrBoxes) {
    const bbox = normalizeBbox(box.box, pageWidth, pageHeight);
    const blockType = classifyBlockType(box.text, bbox);
    const lowConfidence = box.confidence < LOW_CONFIDENCE_THRESHOLD;

    results.push({
      tempId: uuidv7(),
      pageNumber,
      bbox,
      text: box.text,
      blockType,
      ocrConfidence: box.confidence,
      lowConfidence,
      chunkType: "original" as const,
      mergedBlockIds: null,
      parentBlockId: null,
    });
  }

  return results;
}
