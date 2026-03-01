import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmbeddingBatchResult } from "@/lib/embeddings/openai";

describe("EmbeddingBatchResult interface", () => {
  it("successful result has vectors and failed=false", () => {
    const result: EmbeddingBatchResult = {
      blockIds: ["b1", "b2"],
      vectors: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
      failed: false,
      error: null,
    };
    expect(result.failed).toBe(false);
    expect(result.vectors).toHaveLength(2);
    expect(result.error).toBeNull();
  });

  it("failed result has empty vectors and error message", () => {
    const result: EmbeddingBatchResult = {
      blockIds: ["b1", "b2"],
      vectors: [],
      failed: true,
      error: "OpenAI API error 429: rate limited",
    };
    expect(result.failed).toBe(true);
    expect(result.vectors).toHaveLength(0);
    expect(result.error).toContain("rate limited");
  });

  it("blockIds maps 1:1 with vectors on success", () => {
    const result: EmbeddingBatchResult = {
      blockIds: ["b1", "b2", "b3"],
      vectors: [
        Array(1536).fill(0.1),
        Array(1536).fill(0.2),
        Array(1536).fill(0.3),
      ],
      failed: false,
      error: null,
    };
    expect(result.blockIds).toHaveLength(result.vectors.length);
    expect(result.vectors[0]).toHaveLength(1536);
  });
});

describe("embedTexts function", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("batches inputs into groups of 512", async () => {
    // Track fetch calls
    const fetchCalls: any[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      fetchCalls.push(body);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: string, i: number) => ({
            index: i,
            embedding: Array(1536).fill(0.01),
          })),
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    // Dynamically import after mocking
    const { embedTexts } = await import("@/lib/embeddings/openai");

    const inputs = Array.from({ length: 600 }, (_, i) => ({
      blockId: `block-${i}`,
      text: `Text ${i}`,
    }));

    const results = await embedTexts(inputs);

    // Should make 2 batches: 512 + 88
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(fetchCalls[0].input).toHaveLength(512);
    expect(fetchCalls[1].input).toHaveLength(88);
    expect(results).toHaveLength(2);
    expect(results[0].failed).toBe(false);
    expect(results[1].failed).toBe(false);
  });

  it("uses text-embedding-3-small model", async () => {
    const fetchCalls: any[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      fetchCalls.push(body);
      return new Response(
        JSON.stringify({
          data: body.input.map((_: string, i: number) => ({
            index: i,
            embedding: Array(1536).fill(0),
          })),
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embedTexts } = await import("@/lib/embeddings/openai");
    await embedTexts([{ blockId: "b1", text: "test" }]);

    expect(fetchCalls[0].model).toBe("text-embedding-3-small");
  });

  it("handles API error per batch without aborting", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      callCount++;
      const body = JSON.parse(init.body);
      if (callCount === 1) {
        // First batch fails
        return new Response("Rate limited", { status: 429 });
      }
      // Second batch succeeds
      return new Response(
        JSON.stringify({
          data: body.input.map((_: string, i: number) => ({
            index: i,
            embedding: Array(1536).fill(0),
          })),
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const { embedTexts } = await import("@/lib/embeddings/openai");
    const inputs = Array.from({ length: 600 }, (_, i) => ({
      blockId: `block-${i}`,
      text: `Text ${i}`,
    }));

    const results = await embedTexts(inputs);
    expect(results).toHaveLength(2);
    expect(results[0].failed).toBe(true);
    expect(results[0].error).toContain("429");
    expect(results[1].failed).toBe(false);
  });

  it("handles network error gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));

    const { embedTexts } = await import("@/lib/embeddings/openai");
    const results = await embedTexts([{ blockId: "b1", text: "test" }]);

    expect(results).toHaveLength(1);
    expect(results[0].failed).toBe(true);
    expect(results[0].error).toContain("Network failure");
  });
});
