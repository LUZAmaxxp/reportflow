import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations } from "@/lib/db/schema/observations";
import { auditLog } from "@/lib/db/schema/notifications";
import { eq, and, inArray } from "drizzle-orm";

const NORMALIZED_KEY_RE = /^[a-z][a-z0-9_]{0,99}$/;

/**
 * POST /api/observations/merge
 * RISK-11 merge contract.
 * Body: { observation_ids(min2), canonical_label, canonical_normalized_key }.
 * Validates snake_case key, all observations approved and in ctx.companyId.
 * Updates label+normalized_key for all and writes one AuditLog row per observation.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { role, company_id, user_id } = session.user;

  if (role === "viewer") {
    return NextResponse.json(
      { code: "forbidden", message: "Insufficient permissions" },
      { status: 403 }
    );
  }

  let body: {
    observation_ids?: string[];
    canonical_label?: string;
    canonical_normalized_key?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  const { observation_ids, canonical_label, canonical_normalized_key } = body;

  // Validate observation_ids
  if (!Array.isArray(observation_ids) || observation_ids.length < 2) {
    return NextResponse.json(
      { code: "validation_error", message: "observation_ids must contain at least 2 UUIDs" },
      { status: 422 }
    );
  }

  // Validate canonical_label
  if (!canonical_label || typeof canonical_label !== "string" || canonical_label.length < 1 || canonical_label.length > 200) {
    return NextResponse.json(
      { code: "validation_error", message: "canonical_label is required and must be 1-200 characters" },
      { status: 422 }
    );
  }

  // Validate canonical_normalized_key regex
  if (!canonical_normalized_key || !NORMALIZED_KEY_RE.test(canonical_normalized_key)) {
    return NextResponse.json(
      { code: "validation_error", message: "canonical_normalized_key must match ^[a-z][a-z0-9_]{0,99}$" },
      { status: 422 }
    );
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Fetch all observations
      const obs = await tx
        .select({
          observationId: observations.observationId,
          status: observations.status,
          companyId: observations.companyId,
        })
        .from(observations)
        .where(
          and(
            inArray(observations.observationId, observation_ids),
            eq(observations.companyId, company_id)
          )
        );

      // Check all exist in company
      if (obs.length !== observation_ids.length) {
        return {
          error: "forbidden",
          message: "One or more observations not found or in different company",
          status: 403,
        };
      }

      // Check all have status approved
      const nonApproved = obs.filter((o: any) => o.status !== "approved");
      if (nonApproved.length > 0) {
        return {
          error: "non_approved_observations",
          message: "All observations must be approved",
          status: 422,
          offending_ids: nonApproved.map((o: any) => o.observationId),
        };
      }

      // Update label + normalized_key for all observations
      for (const obsId of observation_ids) {
        await tx
          .update(observations)
          .set({
            label: canonical_label,
            normalizedKey: canonical_normalized_key,
            updatedAt: new Date(),
          })
          .where(eq(observations.observationId, obsId));

        // Write one audit row per observation
        await tx.insert(auditLog).values({
          companyId: company_id,
          entityType: "observation",
          entityId: obsId,
          action: "merge",
          actorId: user_id,
          metadata: {
            canonical_label,
            canonical_normalized_key,
            merged_observation_ids: observation_ids,
          },
        });
      }

      return {
        updated_count: observation_ids.length,
        canonical_normalized_key,
      };
    });

    if ("error" in result) {
      const resp: Record<string, unknown> = {
        code: result.error,
        message: result.message,
      };
      if ("offending_ids" in result) {
        resp.offending_ids = result.offending_ids;
      }
      return NextResponse.json(resp, { status: result.status as number });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[POST /api/observations/merge] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
