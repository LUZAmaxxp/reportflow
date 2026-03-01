import type { ParsedObservation } from "./parseExtraction";

/**
 * Validation utility that prevents unsupported evidence references.
 * Keeps only observations where every evidence_block_id exists in known block ids.
 */

export interface HallucinationGuardResult {
  valid: ParsedObservation[];
  skippedCount: number;
  skippedDetails: Array<{ normalizedKey: string; invalidBlockIds: string[] }>;
}

/**
 * Rejects observations referencing unknown evidence blocks.
 * Returns filtered observation array plus counters/metadata for skipped observations.
 */
export function validateBlockIds(
  observations: ParsedObservation[],
  knownBlockIdsSet: Set<string>
): HallucinationGuardResult {
  const valid: ParsedObservation[] = [];
  const skippedDetails: Array<{ normalizedKey: string; invalidBlockIds: string[] }> = [];

  for (const obs of observations) {
    const invalidBlockIds = obs.evidence_block_ids.filter(
      (id) => !knownBlockIdsSet.has(id)
    );

    if (invalidBlockIds.length > 0) {
      // Emit structured warning
      console.warn(
        `[HallucinationGuard] Discarding observation "${obs.normalized_key}": references unknown evidence blocks`,
        { normalizedKey: obs.normalized_key, invalidBlockIds }
      );
      skippedDetails.push({
        normalizedKey: obs.normalized_key,
        invalidBlockIds,
      });
    } else {
      valid.push(obs);
    }
  }

  return {
    valid,
    skippedCount: skippedDetails.length,
    skippedDetails,
  };
}
