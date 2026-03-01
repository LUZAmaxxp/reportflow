export interface LatestWinsResult {
  winner: { id: string };
  loser: { id: string };
}

interface ObsWithProvenance {
  id: string;
  provenanceType: "document" | "manual";
  documentUploadedAt?: Date | string | null;
  attestationCreatedAt?: Date | string | null;
  docDate?: Date | string | null;
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  return typeof d === "string" ? new Date(d) : d;
}

/**
 * Resolve source timestamps:
 *   provenance_type=document -> document_version.uploaded_at
 *   provenance_type=manual   -> attestation_record.created_at
 * Return { winner, loser }. If timestamps are equal, obsA wins (log anomaly).
 * If document embedded doc_date differs from uploaded_at by >30 days, log anomaly notice.
 */
export function latestWins(obsA: ObsWithProvenance, obsB: ObsWithProvenance): LatestWinsResult {
  const tsA = getTimestamp(obsA);
  const tsB = getTimestamp(obsB);

  // Check if document embedded doc_date differs from uploaded_at by >30 days
  checkDocDateAnomaly(obsA);
  checkDocDateAnomaly(obsB);

  if (!tsA && !tsB) {
    console.warn("[latestWins] Both timestamps are null, returning obsA as winner (anomaly)");
    return { winner: { id: obsA.id }, loser: { id: obsB.id } };
  }

  if (!tsA) return { winner: { id: obsB.id }, loser: { id: obsA.id } };
  if (!tsB) return { winner: { id: obsA.id }, loser: { id: obsB.id } };

  if (tsA.getTime() === tsB.getTime()) {
    console.warn("[latestWins] Equal timestamps, returning obsA as winner (anomaly)", {
      obsA: obsA.id,
      obsB: obsB.id,
      timestamp: tsA.toISOString(),
    });
    return { winner: { id: obsA.id }, loser: { id: obsB.id } };
  }

  if (tsA.getTime() > tsB.getTime()) {
    return { winner: { id: obsA.id }, loser: { id: obsB.id } };
  }

  return { winner: { id: obsB.id }, loser: { id: obsA.id } };
}

function getTimestamp(obs: ObsWithProvenance): Date | null {
  if (obs.provenanceType === "document") {
    return toDate(obs.documentUploadedAt);
  }
  return toDate(obs.attestationCreatedAt);
}

function checkDocDateAnomaly(obs: ObsWithProvenance): void {
  if (obs.provenanceType !== "document") return;
  const uploadedAt = toDate(obs.documentUploadedAt);
  const docDate = toDate(obs.docDate);
  if (!uploadedAt || !docDate) return;
  const diffMs = Math.abs(uploadedAt.getTime() - docDate.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays > 30) {
    console.warn("[latestWins] anomaly_notice: doc_date differs from uploaded_at by >30 days", {
      obsId: obs.id,
      uploadedAt: uploadedAt.toISOString(),
      docDate: docDate.toISOString(),
      diffDays: Math.round(diffDays),
    });
  }
}
