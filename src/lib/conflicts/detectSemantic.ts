import { sql, eq, and, ne } from "drizzle-orm";
import { observations } from "@/lib/db/schema/observations";

/**
 * Candidate pair query builder based on pg_trgm similarity + unit/time overlap.
 * Finds approved observations in the same company that might conflict with obs_a.
 */
export async function findCandidatePairs(
  db: any,
  observationId: string,
  companyId: string
): Promise<Array<typeof observations.$inferSelect>> {
  // First load obs_a
  const [obsA] = await db
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.observationId, observationId),
        eq(observations.companyId, companyId)
      )
    )
    .limit(1);

  if (!obsA) return [];

  // Query candidates with pg_trgm similarity OR unit match AND period overlap
  // Use column aliases to return camelCase matching Drizzle schema types
  const candidates = await db.execute(
    sql`SELECT
          o.observation_id AS "observationId",
          o.company_id AS "companyId",
          o.label,
          o.normalized_key AS "normalizedKey",
          o.value,
          o.numeric_value AS "numericValue",
          o.unit,
          o.data_type AS "dataType",
          o.time_behavior AS "timeBehavior",
          o.period_start AS "periodStart",
          o.period_end AS "periodEnd",
          o.category_id AS "categoryId",
          o.source_document_version_id AS "sourceDocumentVersionId",
          o.status,
          o.provenance_type AS "provenanceType",
          o.evidence_block_ids AS "evidenceBlockIds",
          o.attestation_record_id AS "attestationRecordId",
          o.confidence_score AS "confidenceScore",
          o.extraction_run_id AS "extractionRunId",
          o.created_at AS "createdAt",
          o.updated_at AS "updatedAt",
          o.created_by AS "createdBy"
        FROM observation o
    WHERE o.company_id = ${companyId}
      AND o.observation_id != ${observationId}
      AND o.status = 'approved'
      AND (
        similarity(o.normalized_key, ${obsA.normalizedKey}) >= 0.5
        OR o.unit = ${obsA.unit}
      )
      AND o.period_start <= ${obsA.periodEnd}
      AND o.period_end >= ${obsA.periodStart}`
  );

  return candidates.rows ?? candidates;
}
