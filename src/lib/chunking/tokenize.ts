import { get_encoding } from "tiktoken";

const encoder = get_encoding("cl100k_base");

/**
 * Computes token count for merge/split decisions using cl100k_base.
 * Deterministic behavior across worker runs.
 */
export function countTokens(text: string): number {
  return encoder.encode(text).length;
}

export function freeEncoder(): void {
  encoder.free();
}
