import { createHash } from "crypto";

/**
 * Canonical pair hashing utility for KeyEquivalenceCache lookups and inserts.
 * Sorts the two keys alphabetically, joins with ':', prepends companyId,
 * computes SHA-256, and returns a lowercase hex digest.
 * Deterministic: buildCacheKey('c','b','a') === buildCacheKey('c','a','b').
 * Company-scoped to prevent cross-tenant cache sharing.
 */
export function buildCacheKey(companyId: string, keyA: string, keyB: string): string {
  const sorted = [keyA, keyB].sort();
  const input = `${companyId}:${sorted.join(":")}`;
  return createHash("sha256").update(input).digest("hex").toLowerCase();
}
