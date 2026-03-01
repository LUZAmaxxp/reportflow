import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { applyTransition } from "@/lib/observations/transitions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StatusPatchBody {
  status: "approved" | "rejected" | "candidate";
}

const statusSchema = z.object({
  status: z.enum(["approved", "rejected", "candidate"]),
});

/**
 * PATCH /api/observations/{id}/status
 * Observation status transition API.
 * Role-gated to editor|admin; viewer gets 403.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { id: obsId } = await params;
  const { company_id, role, user_id } = session.user;

  // Role gate
  if (role === "viewer") {
    return NextResponse.json(
      { code: "forbidden", message: "Viewers cannot change observation status" },
      { status: 403 }
    );
  }

  if (!UUID_RE.test(obsId)) {
    return NextResponse.json(
      { code: "observation_not_found", message: "Observation not found" },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_transition", from: "unknown", to: "unknown" },
      { status: 422 }
    );
  }

  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "invalid_transition", from: "unknown", to: "unknown" },
      { status: 422 }
    );
  }

  const { status: toStatus } = parsed.data;

  const result = await withTenant(db, company_id, async (tx) => {
    return applyTransition(tx, obsId, toStatus, user_id, role, company_id);
  });

  if (!result.success) {
    if (result.errorCode === "not_found") {
      return NextResponse.json(
        { code: "observation_not_found", message: "Observation not found or outside tenant scope" },
        { status: 404 }
      );
    }

    if (result.errorCode === "invalid_transition") {
      return NextResponse.json(
        { code: "invalid_transition", from: result.from, to: result.to },
        { status: 422 }
      );
    }
  }

  return NextResponse.json({
    id: result.observationId,
    status: result.to,
    updatedAt: result.updatedAt,
  });
}
