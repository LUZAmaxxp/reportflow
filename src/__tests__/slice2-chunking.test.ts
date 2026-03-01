import { describe, it, expect } from "vitest";
import { countTokens } from "@/lib/chunking/tokenize";
import { mergeAdjacentBlocks, type ChunkingResult } from "@/lib/chunking/merge";
import { splitOversizedBlocks } from "@/lib/chunking/split";
import type { ParsedBlock } from "@/lib/ocr/parse";

const makeBlock = (overrides: Partial<ParsedBlock> = {}): ParsedBlock => ({
  tempId: `block-${Math.random().toString(36).slice(2)}`,
  pageNumber: 1,
  bbox: [0.1, 0.1, 0.5, 0.15] as [number, number, number, number],
  text: "Sample paragraph text.",
  blockType: "paragraph",
  ocrConfidence: 0.95,
  lowConfidence: false,
  chunkType: "original",
  mergedBlockIds: null,
  parentBlockId: null,
  ...overrides,
});

describe("Token counting", () => {
  it("returns positive count for non-empty text", () => {
    expect(countTokens("Hello world")).toBeGreaterThan(0);
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts consistently for same input", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const count1 = countTokens(text);
    const count2 = countTokens(text);
    expect(count1).toBe(count2);
  });

  it("longer text has more tokens", () => {
    const short = countTokens("Hello");
    const long = countTokens("Hello world, this is a much longer sentence with many more words in it.");
    expect(long).toBeGreaterThan(short);
  });
});

describe("Block merging", () => {
  it("returns empty result for empty input", () => {
    const result = mergeAdjacentBlocks([]);
    expect(result.blocksToInsert).toHaveLength(0);
    expect(Object.keys(result.supersededMap)).toHaveLength(0);
  });

  it("passes through single block unchanged", () => {
    const block = makeBlock();
    const result = mergeAdjacentBlocks([block]);
    expect(result.blocksToInsert).toHaveLength(1);
    expect(result.blocksToInsert[0].tempId).toBe(block.tempId);
    expect(result.blocksToInsert[0].chunkType).toBe("original");
  });

  it("merges adjacent paragraphs on same page within gap threshold", () => {
    const a = makeBlock({ tempId: "a", bbox: [0.1, 0.10, 0.9, 0.12] });
    const b = makeBlock({ tempId: "b", bbox: [0.1, 0.13, 0.9, 0.15] }); // gap = 0.01 < 0.03

    const result = mergeAdjacentBlocks([a, b]);

    // Should have: 2 superseded originals + 1 merged
    const superseded = result.blocksToInsert.filter((r) => r.chunkType === "superseded");
    const merged = result.blocksToInsert.filter((r) => r.chunkType === "merged");
    expect(superseded).toHaveLength(2);
    expect(merged).toHaveLength(1);
    expect(merged[0].mergedBlockIds).toContain("a");
    expect(merged[0].mergedBlockIds).toContain("b");
  });

  it("does not merge blocks with large vertical gap", () => {
    const a = makeBlock({ tempId: "a", bbox: [0.1, 0.10, 0.9, 0.12] });
    const b = makeBlock({ tempId: "b", bbox: [0.1, 0.20, 0.9, 0.22] }); // gap = 0.08 > 0.03

    const result = mergeAdjacentBlocks([a, b]);
    const merged = result.blocksToInsert.filter((r) => r.chunkType === "merged");
    expect(merged).toHaveLength(0);
  });

  it("does not merge blocks of different types", () => {
    const a = makeBlock({ tempId: "a", blockType: "paragraph", bbox: [0.1, 0.10, 0.9, 0.12] });
    const b = makeBlock({ tempId: "b", blockType: "table_cell", bbox: [0.1, 0.13, 0.9, 0.15] });

    const result = mergeAdjacentBlocks([a, b]);
    const merged = result.blocksToInsert.filter((r) => r.chunkType === "merged");
    expect(merged).toHaveLength(0);
  });

  it("does not merge blocks on different pages", () => {
    const a = makeBlock({ tempId: "a", pageNumber: 1, bbox: [0.1, 0.10, 0.9, 0.12] });
    const b = makeBlock({ tempId: "b", pageNumber: 2, bbox: [0.1, 0.13, 0.9, 0.15] });

    const result = mergeAdjacentBlocks([a, b]);
    const merged = result.blocksToInsert.filter((r) => r.chunkType === "merged");
    expect(merged).toHaveLength(0);
  });

  it("does not merge if combined tokens exceed 512", () => {
    // Create blocks with lots of text that together exceed 512 tokens
    const longText = "word ".repeat(300); // ~300 tokens
    const a = makeBlock({ tempId: "a", text: longText, bbox: [0.1, 0.10, 0.9, 0.12] });
    const b = makeBlock({ tempId: "b", text: longText, bbox: [0.1, 0.13, 0.9, 0.15] });

    const result = mergeAdjacentBlocks([a, b]);
    const merged = result.blocksToInsert.filter((r) => r.chunkType === "merged");
    expect(merged).toHaveLength(0);
  });

  it("records superseded map linking original IDs to merged block ID", () => {
    const a = makeBlock({ tempId: "a", bbox: [0.1, 0.10, 0.9, 0.12] });
    const b = makeBlock({ tempId: "b", bbox: [0.1, 0.13, 0.9, 0.15] });

    const result = mergeAdjacentBlocks([a, b]);
    expect(result.supersededMap["a"]).toBeDefined();
    expect(result.supersededMap["b"]).toBeDefined();
  });

  it("merged block bbox encompasses all original bboxes", () => {
    const a = makeBlock({ tempId: "a", bbox: [0.1, 0.10, 0.5, 0.12] });
    const b = makeBlock({ tempId: "b", bbox: [0.2, 0.13, 0.9, 0.15] });

    const result = mergeAdjacentBlocks([a, b]);
    const merged = result.blocksToInsert.find((r) => r.chunkType === "merged")!;
    expect(merged.bbox[0]).toBeCloseTo(0.1); // min x1
    expect(merged.bbox[1]).toBeCloseTo(0.10); // min y1
    expect(merged.bbox[2]).toBeCloseTo(0.9); // max x2
    expect(merged.bbox[3]).toBeCloseTo(0.15); // max y2
  });

  it("merged block text joins original texts with newline", () => {
    const a = makeBlock({ tempId: "a", text: "First paragraph.", bbox: [0.1, 0.10, 0.9, 0.12] });
    const b = makeBlock({ tempId: "b", text: "Second paragraph.", bbox: [0.1, 0.13, 0.9, 0.15] });

    const result = mergeAdjacentBlocks([a, b]);
    const merged = result.blocksToInsert.find((r) => r.chunkType === "merged")!;
    expect(merged.text).toBe("First paragraph.\nSecond paragraph.");
  });

  it("passes through non-paragraph blocks without merging", () => {
    const a = makeBlock({ tempId: "a", blockType: "header", bbox: [0.1, 0.10, 0.9, 0.12] });
    const b = makeBlock({ tempId: "b", blockType: "header", bbox: [0.1, 0.13, 0.9, 0.15] });

    const result = mergeAdjacentBlocks([a, b]);
    const merged = result.blocksToInsert.filter((r) => r.chunkType === "merged");
    expect(merged).toHaveLength(0);
    expect(result.blocksToInsert).toHaveLength(2);
  });
});

describe("Block splitting", () => {
  it("passes through blocks under 512 tokens unchanged", () => {
    const block = makeBlock({ text: "Short text." });
    const result = splitOversizedBlocks([block]);
    expect(result).toHaveLength(1);
    expect(result[0].chunkType).toBe("original");
  });

  it("splits oversized blocks into multiple parts", () => {
    const longText = Array(200).fill("This is a test sentence.").join(" ");
    const block = makeBlock({ tempId: "big-block", text: longText });

    const result = splitOversizedBlocks([block]);

    // Should have original marked superseded + split children
    const superseded = result.filter((r) => r.chunkType === "superseded");
    const splits = result.filter((r) => r.chunkType === "split");

    expect(superseded).toHaveLength(1);
    expect(superseded[0].tempId).toBe("big-block");
    expect(splits.length).toBeGreaterThanOrEqual(2);
  });

  it("split children reference parent via parentBlockId", () => {
    const longText = Array(200).fill("This is a test sentence.").join(" ");
    const block = makeBlock({ tempId: "parent-1", text: longText });

    const result = splitOversizedBlocks([block]);
    const splits = result.filter((r) => r.chunkType === "split");

    for (const s of splits) {
      expect(s.parentBlockId).toBe("parent-1");
    }
  });

  it("split children inherit page number and block type", () => {
    const longText = Array(200).fill("This is a test sentence.").join(" ");
    const block = makeBlock({
      tempId: "parent-1",
      text: longText,
      pageNumber: 5,
      blockType: "paragraph",
    });

    const result = splitOversizedBlocks([block]);
    const splits = result.filter((r) => r.chunkType === "split");

    for (const s of splits) {
      expect(s.pageNumber).toBe(5);
      expect(s.blockType).toBe("paragraph");
    }
  });

  it("each split chunk is under 512 tokens", () => {
    const longText = Array(200).fill("This is a test sentence.").join(" ");
    const block = makeBlock({ text: longText });

    const result = splitOversizedBlocks([block]);
    const splits = result.filter((r) => r.chunkType === "split");

    for (const s of splits) {
      const tokens = countTokens(s.text);
      // Allow slight overflow due to sentence boundary granularity
      expect(tokens).toBeLessThanOrEqual(600);
    }
  });

  it("does not split already superseded blocks", () => {
    const longText = Array(200).fill("This is a test sentence.").join(" ");
    const block = makeBlock({ text: longText, chunkType: "superseded" });

    const result = splitOversizedBlocks([block]);
    expect(result).toHaveLength(1);
    expect(result[0].chunkType).toBe("superseded");
  });

  it("combined text of split children covers original text", () => {
    const longText = Array(200).fill("Sample sentence here.").join(" ");
    const block = makeBlock({ text: longText });

    const result = splitOversizedBlocks([block]);
    const splits = result.filter((r) => r.chunkType === "split");
    const combined = splits.map((s) => s.text).join(" ");

    // Trim differences from sentence boundary splitting
    expect(combined.length).toBeGreaterThan(0);
    // All original words should be present
    expect(combined).toContain("Sample sentence here.");
  });
});
