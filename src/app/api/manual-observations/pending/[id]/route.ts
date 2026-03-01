import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { pendingManualObservations } from "@/lib/db/schema/observations";
import { eq, and, gt } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SPEC DEVIATION: pending_obs_status DB enum value is `timed_out` (SQL) but API/response layer
// exposes it as `timeout` per §5.8 contract.
type PendingStatusDb = "pending" | "confirmed" | "skipped" | "timed_out";
type PendingStatusApi = "pending" | "confirmed" | "skipped" | "timeout";
type PendingObservationResponse = { pending_id: string; status: PendingStatusApi; observation_id: string | null; created_at: string; expires_at: string };

function mapDbStatusToApi(dbStatus: PendingStatusDb): PendingStatusApi {
  if (dbStatus === "timed_out") return "timeout";
  return dbStatus as PendingStatusApi;
}

/**
 * GET /api/manual-observations/pending/{id} — Poll pending manual observation status.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { code: "pending_not_found", message: "Pending observation not found" },
      { status: 404 }
    );
  }

  const { company_id } = session.user;

  const result = await withTenant(db, company_id, async (tx) => {
    const [row] = await tx
      .select({
        pending_id: pendingManualObservations.pendingId,
        status: pendingManualObservations.status,
        observation_id: pendingManualObservations.observationId,
        created_at: pendingManualObservations.createdAt,
        expires_at: pendingManualObservations.expiresAt,
      })
      .from(pendingManualObservations)
      .where(
        and(
          eq(pendingManualObservations.pendingId, id),
          eq(pendingManualObservations.companyId, company_id)
        )
      )
      .limit(1);

    return row;
  });

  if (!result) {
    return NextResponse.json(
      { code: "pending_not_found", message: "Pending observation not found" },
      { status: 404 }
    );
  }

  // Check if expired and still pending
  const now = new Date();
  const expiresAt = new Date(result.expires_at);
  if (result.status === "pending" && now > expiresAt) {
    return NextResponse.json(
      { code: "pending_not_found", message: "Pending observation not found" },
      { status: 404 }
    );
  }

  const response: PendingObservationResponse = {
    pending_id: result.pending_id,
    status: mapDbStatusToApi(result.status as PendingStatusDb),
    observation_id: result.observation_id ?? null,
    created_at: result.created_at?.toISOString?.() ?? String(result.created_at),
    expires_at: result.expires_at?.toISOString?.() ?? String(result.expires_at),
  };

  return NextResponse.json(response);
}
