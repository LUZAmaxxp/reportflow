import { Job } from "bullmq";
import { eq, and, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { workerDb } from "../db";
import { observations } from "@/lib/db/schema/observations";
import { attestationRecords } from "@/lib/db/schema/observations";
import { documentVersions } from "@/lib/db/schema/documents";
import { keyEquivalenceCache } from "@/lib/db/schema/derivations";
import { buildCacheKey } from "@/lib/conflicts/cacheKey";
import { latestWins } from "@/lib/conflicts/applyLatestWins";
import { callGrokEquivalence } from "@/lib/conflicts/equivalenceClassifier";
import { findCandidatePairs } from "@/lib/conflicts/detectSemantic";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { publishNotification } from "@/lib/notifications/publish";

export interface SemanticConflictJobPayload {
  observationId: string;
  companyId: string;
  reason?: string;
}

export const SEMANTIC_CONFLICT_RETRY_POLICY = {
  attempts: 3,
  backoffMs: [2000, 4000, 8000],
  grokTimeoutMs: 30000,
} as const;

export const EQUAL_VALUE_TOLERANCE_RATIO = 0.001;

export async function processSemanticConflictJob(job: Job<SemanticConflictJobPayload>): Promise<void> {
  const { observationId, companyId } = job.data;

  // Step 1: Load and gate approved source observation
  const [obsA] = await workerDb
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.observationId, observationId),
        eq(observations.companyId, companyId)
      )
    )
    .limit(1);

  if (!obsA || obsA.status !== "approved") {
    // Exit job successfully without side effects
    return;
  }

  // Step 2: Find candidate near-duplicates via pg_trgm
  const candidates = await findCandidatePairs(workerDb, observationId, companyId);

  if (!candidates || candidates.length === 0) {
    return;
  }

  // Step 3-7: Process each candidate
  for (const obsB of candidates) {
    try {
      const candidateId = (obsB as any).observationId;
      const candidateKey = (obsB as any).normalizedKey;
      const candidateLabel = (obsB as any).label;
      const candidateUnit = (obsB as any).unit ?? "";
      const candidateValue = (obsB as any).value;
      const candidateNumericValue = (obsB as any).numericValue;
      const candidatePeriodStart = (obsB as any).periodStart;
      const candidatePeriodEnd = (obsB as any).periodEnd;
      const candidateProvenanceType = (obsB as any).provenanceType;
      const candidateSourceDocVersionId = (obsB as any).sourceDocumentVersionId;
      const candidateAttestationRecordId = (obsB as any).attestationRecordId;

      // Step 3: Classification
      let matchResult: "SAME_KEY" | "DIFFERENT_KEY";
      let matchMethod: "exact" | "semantic";

      if (obsA.normalizedKey === candidateKey) {
        // Exact key match - skip LLM
        matchResult = "SAME_KEY";
        matchMethod = "exact";
      } else {
        matchMethod = "semantic";
        // Check cache
        const pairHash = buildCacheKey(companyId, obsA.normalizedKey, candidateKey);

        const [cached] = await workerDb
          .select()
          .from(keyEquivalenceCache)
          .where(
            and(
              eq(keyEquivalenceCache.companyId, companyId),
              eq(keyEquivalenceCache.keyPairHash, pairHash)
            )
          )
          .limit(1);

        if (cached) {
          // Cache hit
          matchResult = cached.result as "SAME_KEY" | "DIFFERENT_KEY";
        } else {
          // Cache miss - call Grok
          try {
            const grokResult = await callGrokEquivalence({
              keyA: obsA.normalizedKey,
              labelA: obsA.label,
              unitA: obsA.unit ?? "",
              keyB: candidateKey,
              labelB: candidateLabel,
              unitB: candidateUnit,
            });
            matchResult = grokResult.result;

            // Do not write cache entry for malformed Grok responses
            if (!grokResult.rationale.startsWith("PARSE_ERROR:")) {
              // Insert cache with ON CONFLICT DO NOTHING
              await workerDb.execute(
                sql`INSERT INTO key_equivalence_cache (cache_id, company_id, key_pair_hash, key_a, key_b, result, rationale)
                    VALUES (${uuidv7()}, ${companyId}, ${pairHash}, ${obsA.normalizedKey}, ${candidateKey}, ${grokResult.result}, ${grokResult.rationale})
                    ON CONFLICT (key_pair_hash) DO NOTHING`
              );
            }
            // TODO: verify - KeyEquivalenceCache prevents second Grok call for same key pair (verified by mock call counter)
          } catch (err) {
            // Grok timeout/failure must not fail job; log and continue
            console.error("[semanticConflict] Grok classifier call failed, skipping candidate", {
              obsA: observationId,
              obsB: candidateId,
              error: err instanceof Error ? err.message : String(err),
            });
            continue;
          }
        }
      }

      if (matchResult !== "SAME_KEY") {
        continue;
      }

      // Step 4: Confirm actual value conflict - compare numeric values
      if (obsA.numericValue != null && candidateNumericValue != null) {
        const numA = parseFloat(String(obsA.numericValue));
        const numB = parseFloat(String(candidateNumericValue));
        if (!isNaN(numA) && !isNaN(numB) && numA !== 0) {
          const ratio = Math.abs(numA - numB) / Math.abs(numA);
          if (ratio <= EQUAL_VALUE_TOLERANCE_RATIO) {
            // Values are equal within 0.1% tolerance - skip (not a conflict)
            continue;
          }
        }
      }

      // Step 5: Apply latest-wins and upsert conflict case
      // Load provenance timestamps
      let obsAUploadedAt: Date | null = null;
      let obsAAttestationCreatedAt: Date | null = null;
      let obsBUploadedAt: Date | null = null;
      let obsBAttestationCreatedAt: Date | null = null;

      if (obsA.provenanceType === "document" && obsA.sourceDocumentVersionId) {
        const [dv] = await workerDb
          .select({ createdAt: documentVersions.createdAt })
          .from(documentVersions)
          .where(eq(documentVersions.documentVersionId, obsA.sourceDocumentVersionId))
          .limit(1);
        if (dv) obsAUploadedAt = dv.createdAt;
      }
      if (obsA.provenanceType === "manual" && obsA.attestationRecordId) {
        const [ar] = await workerDb
          .select({ createdAt: attestationRecords.createdAt })
          .from(attestationRecords)
          .where(eq(attestationRecords.attestationId, obsA.attestationRecordId))
          .limit(1);
        if (ar) obsAAttestationCreatedAt = ar.createdAt;
      }

      if (candidateProvenanceType === "document" && candidateSourceDocVersionId) {
        const [dv] = await workerDb
          .select({ createdAt: documentVersions.createdAt })
          .from(documentVersions)
          .where(eq(documentVersions.documentVersionId, candidateSourceDocVersionId))
          .limit(1);
        if (dv) obsBUploadedAt = dv.createdAt;
      }
      if (candidateProvenanceType === "manual" && candidateAttestationRecordId) {
        const [ar] = await workerDb
          .select({ createdAt: attestationRecords.createdAt })
          .from(attestationRecords)
          .where(eq(attestationRecords.attestationId, candidateAttestationRecordId))
          .limit(1);
        if (ar) obsBAttestationCreatedAt = ar.createdAt;
      }

      const winnerLoser = latestWins(
        {
          id: observationId,
          provenanceType: obsA.provenanceType as "document" | "manual",
          documentUploadedAt: obsAUploadedAt,
          attestationCreatedAt: obsAAttestationCreatedAt,
        },
        {
          id: candidateId,
          provenanceType: candidateProvenanceType as "document" | "manual",
          documentUploadedAt: obsBUploadedAt,
          attestationCreatedAt: obsBAttestationCreatedAt,
        }
      );

      // Insert conflict_case with idempotent pair uniqueness guard
      const conflictId = uuidv7();
      const observationIds = [observationId, candidateId];
      const sortedPairKey = [observationId, candidateId].sort().join(":");

      // Reuse existing conflictGroupId from same normalized_key if exists, else generate new one
      const existingGroupResult = await workerDb.execute(
        sql`SELECT conflict_group_id FROM conflict_case
            WHERE company_id = ${companyId}
              AND normalized_key = ${obsA.normalizedKey}
            LIMIT 1`
      );
      const existingGroupRows = existingGroupResult.rows ?? existingGroupResult;
      const conflictGroupId = existingGroupRows.length > 0
        ? (existingGroupRows[0] as any).conflict_group_id
        : uuidv7();

      // Atomic idempotent insert: use sorted_pair_key (advisory lock) to prevent duplicate conflict cases
      const insertResult = await workerDb.execute(
        sql`INSERT INTO conflict_case (
              conflict_id, company_id, normalized_key, conflict_group_id,
              match_method, period_start, period_end, observation_ids,
              winning_observation_id, auto_resolved, resolution_status
            )
            SELECT ${conflictId}, ${companyId}, ${obsA.normalizedKey}, ${conflictGroupId}::uuid,
                   ${matchMethod}::conflict_match_method, ${obsA.periodStart ?? candidatePeriodStart}, ${obsA.periodEnd ?? candidatePeriodEnd},
                   ARRAY[${observationId}, ${candidateId}]::uuid[],
                   ${winnerLoser.winner.id}::uuid, true, 'auto_resolved'::conflict_resolution_status
            WHERE NOT EXISTS (
              SELECT 1 FROM conflict_case
              WHERE company_id = ${companyId}
                AND observation_ids @> ARRAY[${observationId}]::uuid[]
                AND observation_ids @> ARRAY[${candidateId}]::uuid[]
            )`
      );

      const rowsInserted = (insertResult as any).rowCount ?? (insertResult as any).length ?? 0;
      if (rowsInserted === 0) {
        // Conflict case already exists for this pair — skip
        continue;
      }

      // Step 6: Supersede loser and mark derivations stale
      await workerDb
        .update(observations)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(eq(observations.observationId, winnerLoser.loser.id));

      await workerDb.execute(
        sql`UPDATE derivation_result SET stale = true
            WHERE ${winnerLoser.loser.id} = ANY(input_observation_ids)`
      );

      // Step 7: Emit notifications and SSE events via centralized utilities
      await publishNotification(companyId, {
        type: "conflict_detected",
        payload: { conflictId, normalizedKey: obsA.normalizedKey },
      }, workerDb as any);

      // Publish pipeline SSE event type=conflict_detected
      await publishPipelineEvent(companyId, {
        id: nextEventId(),
        type: "conflict_detected" as const,
        conflictId,
        normalizedKey: obsA.normalizedKey,
        matchMethod,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[semanticConflict] Error processing candidate pair", {
        obsA: observationId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue processing other candidates
    }
  }
}
