import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { pendingManualObservations, observations, attestationRecords } from "@/lib/db/schema/observations";
import { documentCategories } from "@/lib/db/schema/documents";
import { eq, and } from "drizzle-orm";
import { redis } from "@/lib/redis";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

type ManualObservationConfirmRequest = {
  label: string;
  normalized_key: string;
  value: string;
  unit?: string | null;
  data_type: "numeric" | "percentage" | "text" | "boolean";
  time_behavior: "periodic" | "point_in_time" | "none";
  period_start?: string | null;
  period_end?: string | null;
  category_id?: string | null;
  source_reference?: string | null;
  note?: string | null;
};

/**
 * POST /api/manual-observations/pending/{id}/confirm — Confirm a pending manual observation.
 */
export async function POST(
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

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { code: "pending_not_found", message: "Pending observation not found" },
      { status: 404 }
    );
  }

  let body: ManualObservationConfirmRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid JSON body" },
      { status: 422 }
    );
  }

  // Validate fields
  const errors: string[] = [];

  if (!body.label || typeof body.label !== "string" || body.label.length > 200) {
    errors.push("label is required and must be at most 200 characters");
  }

  if (!body.normalized_key || typeof body.normalized_key !== "string" || body.normalized_key.length > 100 || !SNAKE_CASE_RE.test(body.normalized_key)) {
    errors.push("normalized_key is required, must be snake_case and at most 100 characters");
  }

  if (!body.value || typeof body.value !== "string") {
    errors.push("value is required");
  }

  if (body.unit !== undefined && body.unit !== null && typeof body.unit === "string" && body.unit.length > 50) {
    errors.push("unit must be at most 50 characters");
  }

  if (!["numeric", "percentage", "text", "boolean"].includes(body.data_type)) {
    errors.push("data_type must be one of: numeric, percentage, text, boolean");
  }

  if (!["periodic", "point_in_time", "none"].includes(body.time_behavior)) {
    errors.push("time_behavior must be one of: periodic, point_in_time, none");
  }

  if (body.time_behavior === "periodic") {
    if (!body.period_start) errors.push("period_start is required when time_behavior is periodic");
    if (!body.period_end) errors.push("period_end is required when time_behavior is periodic");
    if (body.period_start && body.period_end && body.period_end < body.period_start) {
      errors.push("period_end must be >= period_start");
    }
  }

  if (body.source_reference && typeof body.source_reference === "string" && body.source_reference.length > 500) {
    errors.push("source_reference must be at most 500 characters");
  }

  if (body.note && typeof body.note === "string" && body.note.length > 1000) {
    errors.push("note must be at most 1000 characters");
  }

  if (body.category_id && !UUID_RE.test(body.category_id)) {
    errors.push("category_id must be a valid UUID");
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { code: "validation_error", message: errors.join("; ") },
      { status: 422 }
    );
  }

  const { user_id, company_id } = session.user;

  const result = await withTenant(db, company_id, async (tx) => {
    // Load pending record
    const [pending] = await tx
      .select({
        pending_id: pendingManualObservations.pendingId,
        status: pendingManualObservations.status,
        company_id: pendingManualObservations.companyId,
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

    // Validate category_id belongs to company if provided
    if (body.category_id) {
      const [cat] = await tx
        .select({ categoryId: documentCategories.categoryId })
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.categoryId, body.category_id),
            eq(documentCategories.companyId, company_id)
          )
        )
        .limit(1);

      if (!cat) {
        return { error: "validation_error" as const, message: "category_id not found in company" };
      }
    }

    // Create attestation record
    const [attestation] = await tx
      .insert(attestationRecords)
      .values({
        companyId: company_id,
        createdBy: user_id,
        note: body.note ?? null,
        sourceReference: body.source_reference ?? null,
      })
      .returning({ attestation_id: attestationRecords.attestationId });

    // Compute numeric_value for numeric data types
    let numericValue: string | null = null;
    if (body.data_type === "numeric" || body.data_type === "percentage") {
      const parsed = parseFloat(body.value);
      if (!isNaN(parsed)) {
        numericValue = parsed.toString();
      }
    }

    // Create manual observation with status=approved
    const [obs] = await tx
      .insert(observations)
      .values({
        companyId: company_id,
        label: body.label,
        normalizedKey: body.normalized_key,
        value: body.value,
        numericValue: numericValue,
        unit: body.unit ?? "",
        dataType: body.data_type,
        timeBehavior: body.time_behavior,
        periodStart: body.period_start ?? null,
        periodEnd: body.period_end ?? null,
        categoryId: body.category_id ?? null,
        status: "approved",
        provenanceType: "manual",
        attestationRecordId: attestation.attestation_id,
        createdBy: user_id,
      })
      .returning({ observation_id: observations.observationId });

    // Update pending status to confirmed and store back-reference to created observation
    await tx
      .update(pendingManualObservations)
      .set({ status: "confirmed", observationId: obs.observation_id })
      .where(eq(pendingManualObservations.pendingId, id));

    return { observation_id: obs.observation_id };
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
        { code: "pending_not_pending", message: "Pending observation is no longer in pending state" },
        { status: 409 }
      );
    }
    if (result.error === "validation_error") {
      return NextResponse.json(
        { code: "validation_error", message: (result as any).message },
        { status: 422 }
      );
    }
  }

  // Publish pub/sub notification so agent loop unblocks
  await redis.publish(
    `pending-obs:${id}`,
    JSON.stringify({ status: "confirmed", observation_id: (result as any).observation_id })
  );

  return NextResponse.json({
    observation_id: (result as any).observation_id,
    status: "approved",
  });
}
