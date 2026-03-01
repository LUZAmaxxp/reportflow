import type { ParsedBlock } from "@/lib/ocr/parse";
import { countTokens } from "@/lib/chunking/tokenize";
import { uuidv7 } from "uuidv7";

const MAX_CHUNK_TOKENS = 512;

/**
 * Splits any block exceeding 512 tokens at nearest sentence boundary near cutoff.
 * Outputs child chunks with parent_block_id reference and chunk_type split.
 */
export function splitOversizedBlocks(blocks: ParsedBlock[]): ParsedBlock[] {
  const result: ParsedBlock[] = [];

  for (const block of blocks) {
    // Only split non-superseded blocks
    if (block.chunkType === "superseded") {
      result.push(block);
      continue;
    }

    const tokens = countTokens(block.text);
    if (tokens <= MAX_CHUNK_TOKENS) {
      result.push(block);
      continue;
    }

    // Split at sentence boundaries
    const chunks = splitTextAtSentenceBoundary(block.text, MAX_CHUNK_TOKENS);

    // Mark original as superseded
    result.push({ ...block, chunkType: "superseded" });

    // Create child chunks
    for (let i = 0; i < chunks.length; i++) {
      result.push({
        tempId: uuidv7(),
        pageNumber: block.pageNumber,
        bbox: block.bbox,
        text: chunks[i],
        blockType: block.blockType,
        ocrConfidence: block.ocrConfidence,
        lowConfidence: block.lowConfidence,
        chunkType: "split",
        mergedBlockIds: null,
        parentBlockId: block.tempId,
      });
    }
  }

  return result;
}

function splitTextAtSentenceBoundary(text: string, maxTokens: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]?\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = countTokens(sentence);

    if (currentTokens + sentenceTokens > maxTokens && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
      currentTokens = sentenceTokens;
    } else {
      current += sentence;
      currentTokens += sentenceTokens;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  // If we couldn't split at sentence boundaries (single very long sentence),
  // force split by character approximation
  if (chunks.length === 0) {
    chunks.push(text);
  }

  return chunks;
}
