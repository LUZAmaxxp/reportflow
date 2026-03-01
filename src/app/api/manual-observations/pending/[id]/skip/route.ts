import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { pendingManualObservations } from "@/lib/db/schema/observations";
import { eq, and } from "drizzle-orm";
import { redis } from "@/lib/redis";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/manual-observations/pending/{id}/skip — Skip a pending observation and resume agent.
 */
export async function POST(
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
    // Load pending record
    const [pending] = await tx
      .select({
        pending_id: pendingManualObservations.pendingId,
        status: pendingManualObservations.status,
      })
      .from(pendingManualObservations)
      .where(
        and(
          eq(pendingManualObservations.pendingId, id),
          eq(pendingManualObservations.companyId, company_id)
        )
      )
      .limit(1);

    if (!pending) {
      return { error: "pending_not_found" as const };
    }

    // Terminal state guard
    if (pending.status !== "pending") {
      return { error: "pending_not_pending" as const };
    }

    // Update status to skipped
    await tx
      .update(pendingManualObservations)
      .set({ status: "skipped" })
      .where(eq(pendingManualObservations.pendingId, id));

    return { pending_id: pending.pending_id, status: "skipped" as const };
  });

  if ("error" in result) {
    if (result.error === "pending_not_found") {
      return NextResponse.json(
        { code: "pending_not_found", message: "Pending observation not found" },
        { status: 404 }
      );
    }
    if (result.error === "pending_not_pending") {
      return NextResponse.json(
        { code: "pending_not_pending", message: "Already in terminal state" },
        { status: 409 }
      );
    }
  }

  // Publish pub/sub notification
  await redis.publish(
    `pending-obs:${id}`,
    JSON.stringify({ status: "skipped" })
  );

  return NextResponse.json({
    pending_id: (result as any).pending_id,
    status: "skipped",
  });
}
