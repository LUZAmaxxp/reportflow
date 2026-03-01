import { describe, it, expect } from "vitest";
import { parseOCRResponse, type ParsedBlock } from "@/lib/ocr/parse";
import type { PaddleOCRBox } from "@/lib/ocr/paddleocr";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/constants";

describe("OCR response parser", () => {
  const makeBox = (
    text: string,
    confidence: number,
    box: number[][] = [[100, 100], [400, 100], [400, 150], [100, 150]]
  ): PaddleOCRBox => ({ text, confidence, box });

  describe("parseOCRResponse", () => {
    it("converts OCR boxes to ParsedBlock array", () => {
      const boxes: PaddleOCRBox[] = [
        makeBox("Hello world", 0.95),
      ];
      const result = parseOCRResponse(boxes, 1, 1000, 1000);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Hello world");
      expect(result[0].pageNumber).toBe(1);
    });

    it("assigns tempId to each block", () => {
      const boxes = [makeBox("Text A", 0.9), makeBox("Text B", 0.8)];
      const result = parseOCRResponse(boxes, 1, 1000, 1000);
      expect(result[0].tempId).toBeDefined();
      expect(result[1].tempId).toBeDefined();
      expect(result[0].tempId).not.toBe(result[1].tempId);
    });

    it("normalizes bbox to [0,1] range", () => {
      const box = makeBox("text", 0.9, [[200, 100], [800, 100], [800, 500], [200, 500]]);
      const result = parseOCRResponse([box], 1, 1000, 1000);
      const [x1, y1, x2, y2] = result[0].bbox;
      expect(x1).toBeCloseTo(0.2);
      expect(y1).toBeCloseTo(0.1);
      expect(x2).toBeCloseTo(0.8);
      expect(y2).toBeCloseTo(0.5);
    });

    it("clamps normalized bbox to [0,1] even with out-of-bounds coordinates", () => {
      const box = makeBox("text", 0.9, [[-50, -50], [1200, -50], [1200, 1200], [-50, 1200]]);
      const result = parseOCRResponse([box], 1, 1000, 1000);
      const [x1, y1, x2, y2] = result[0].bbox;
      expect(x1).toBeGreaterThanOrEqual(0);
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(x2).toBeLessThanOrEqual(1);
      expect(y2).toBeLessThanOrEqual(1);
    });

    it("flags low confidence blocks when below threshold", () => {
      const boxes = [
        makeBox("High conf", 0.95),
        makeBox("Low conf", 0.50),
        makeBox("Exactly threshold", LOW_CONFIDENCE_THRESHOLD),
      ];
      const result = parseOCRResponse(boxes, 1, 1000, 1000);
      expect(result[0].lowConfidence).toBe(false);
      expect(result[1].lowConfidence).toBe(true);
      // At exactly the threshold, not below
      expect(result[2].lowConfidence).toBe(false);
    });

    it("all blocks start as chunkType original", () => {
      const boxes = [makeBox("A", 0.9), makeBox("B", 0.8)];
      const result = parseOCRResponse(boxes, 1, 1000, 1000);
      for (const block of result) {
        expect(block.chunkType).toBe("original");
      }
    });

    it("all blocks have null mergedBlockIds and parentBlockId", () => {
      const boxes = [makeBox("A", 0.9)];
      const result = parseOCRResponse(boxes, 1, 1000, 1000);
      expect(result[0].mergedBlockIds).toBeNull();
      expect(result[0].parentBlockId).toBeNull();
    });

    it("preserves page number correctly", () => {
      const boxes = [makeBox("A", 0.9)];
      const page3 = parseOCRResponse(boxes, 3, 1000, 1000);
      expect(page3[0].pageNumber).toBe(3);
    });

    it("preserves ocr confidence value", () => {
      const boxes = [makeBox("A", 0.876)];
      const result = parseOCRResponse(boxes, 1, 1000, 1000);
      expect(result[0].ocrConfidence).toBe(0.876);
    });

    it("handles empty box array", () => {
      const result = parseOCRResponse([], 1, 1000, 1000);
      expect(result).toHaveLength(0);
    });
  });

  describe("Block type classification heuristics", () => {
    it("classifies small boxes as table_cell", () => {
      // Small relative bbox within a 1000x1000 page
      const box = makeBox("42", 0.9, [[100, 100], [220, 100], [220, 140], [100, 140]]);
      const result = parseOCRResponse([box], 1, 1000, 1000);
      expect(result[0].blockType).toBe("table_cell");
    });

    it("classifies short wide text as header", () => {
      const box = makeBox("Chapter 1: Introduction", 0.95, [[50, 100], [650, 100], [650, 140], [50, 140]]);
      const result = parseOCRResponse([box], 1, 1000, 1000);
      expect(result[0].blockType).toBe("header");
    });

    it("classifies bulleted text as list_item", () => {
      const box = makeBox("- First item in list with details", 0.9, [[100, 100], [800, 100], [800, 200], [100, 200]]);
      const result = parseOCRResponse([box], 1, 1000, 1000);
      expect(result[0].blockType).toBe("list_item");
    });

    it("classifies numbered text as list_item", () => {
      const box = makeBox("1. First numbered item", 0.9, [[100, 100], [800, 100], [800, 200], [100, 200]]);
      const result = parseOCRResponse([box], 1, 1000, 1000);
      expect(result[0].blockType).toBe("list_item");
    });

    it("classifies figure caption text", () => {
      const box = makeBox("Figure 1: Description of the chart showing trends", 0.9, [[100, 100], [800, 100], [800, 200], [100, 200]]);
      const result = parseOCRResponse([box], 1, 1000, 1000);
      expect(result[0].blockType).toBe("figure_caption");
    });

    it("classifies regular text as paragraph", () => {
      const box = makeBox(
        "This is a longer paragraph of text that describes the environmental impact assessment findings from the recent audit.",
        0.9,
        [[100, 100], [900, 100], [900, 300], [100, 300]]
      );
      const result = parseOCRResponse([box], 1, 1000, 1000);
      expect(result[0].blockType).toBe("paragraph");
    });
  });
});

describe("LOW_CONFIDENCE_THRESHOLD constant", () => {
  it("is 0.70", () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.7);
  });
});
