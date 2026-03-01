import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations, attestationRecords } from "@/lib/db/schema/observations";
import { documentCategories } from "@/lib/db/schema/documents";
import { auditLog } from "@/lib/db/schema/notifications";
import { semanticConflictQueue } from "@/lib/queues";
import { eq, and } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

// SPEC DEVIATION: Spec §16 lists POST /api/observations; Slice 4 standardizes POST /api/observations/manual to avoid collision with future GET /api/observations listing and to clearly distinguish manual creation from pipeline-created observations.

export interface ManualObservationRequest {
  label: string;
  normalizedKey: string;
  value: string;
  numericValue?: number;
  unit?: string;
  dataType: "numeric" | "percentage" | "text" | "boolean";
  timeBehavior: "periodic" | "point_in_time" | "none";
  periodStart?: string;
  periodEnd?: string;
  categoryId?: string | null;
  status: "candidate" | "approved";
  note?: string;
  sourceReference?: string;
}

export interface ManualObservationResponse {
  id: string;
  status: "candidate" | "approved";
  attestationRecordId: string;
}

const manualObservationSchema = z.object({
  label: z.string().min(1).max(200),
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
  value: z.string().min(1),
  numericValue: z.number().optional(),
  unit: z.string().max(50).optional(),
  dataType: z.enum(["numeric", "percentage", "text", "boolean"]),
  timeBehavior: z.enum(["periodic", "point_in_time", "none"]),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(["candidate", "approved"]),
  note: z.string().max(1000).optional(),
  sourceReference: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "UNAUTHORIZED", message: "Authentication required" }, { status: 401 });
  }

  const { user_id, company_id, role } = session.user;

  // Enforce role editor|admin (viewer => 403)
  if (role === "viewer") {
    return NextResponse.json({ code: "FORBIDDEN_ROLE", message: "Viewer role cannot create observations" }, { status: 403 });
  }

  let body: ManualObservationRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "VALIDATION_ERROR", message: "Invalid JSON body" }, { status: 422 });
  }

  // Validate with Zod
  const parsed = manualObservationSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json({
      code: "VALIDATION_ERROR",
      field: firstIssue?.path?.join(".") ?? "unknown",
      message: firstIssue?.message ?? "Validation error",
    }, { status: 422 });
  }

  const data = parsed.data;

  // numericValue required when dataType is numeric or percentage
  if ((data.dataType === "numeric" || data.dataType === "percentage") && data.numericValue === undefined) {
    return NextResponse.json({
      code: "VALIDATION_ERROR",
      field: "numericValue",
      message: "numericValue is required for numeric/percentage dataType",
    }, { status: 422 });
  }

  // For periodic timeBehavior, periodStart and periodEnd are required
  if (data.timeBehavior === "periodic") {
    if (!data.periodStart || !data.periodEnd) {
      return NextResponse.json({
        code: "VALIDATION_ERROR",
        field: data.periodStart ? "periodEnd" : "periodStart",
        message: "periodStart and periodEnd are required for periodic timeBehavior",
      }, { status: 422 });
    }
    if (data.periodEnd < data.periodStart) {
      return NextResponse.json({
        code: "VALIDATION_ERROR",
        field: "periodEnd",
        message: "periodEnd must be >= periodStart",
      }, { status: 422 });
    }
  }

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // categoryId if provided must belong to session.company_id
      if (data.categoryId) {
        const [cat] = await tx
          .select({ categoryId: documentCategories.categoryId })
          .from(documentCategories)
          .where(
            and(
              eq(documentCategories.categoryId, data.categoryId),
              eq(documentCategories.companyId, company_id)
            )
          )
          .limit(1);

        if (!cat) {
          return {
            error: "VALIDATION_ERROR",
            field: "categoryId",
            message: "Category not found or does not belong to tenant",
          };
        }
      }

      const observationId = uuidv7();
      const attestationId = uuidv7();

      // Determine attestation action
      const attestationAction = data.status === "approved" ? "approved" : "submitted";

      // Insert attestation_record
      await tx.insert(attestationRecords).values({
        attestationId,
        companyId: company_id,
        createdBy: user_id,
        action: attestationAction,
        note: data.note ?? null,
        sourceReference: data.sourceReference ?? null,
      });

      // Insert observation
      await tx.insert(observations).values({
        observationId,
        companyId: company_id,
        label: data.label,
        normalizedKey: data.normalizedKey,
        value: data.value,
        numericValue: data.numericValue?.toString() ?? null,
        unit: data.unit ?? "",
        dataType: data.dataType,
        timeBehavior: data.timeBehavior,
        periodStart: data.periodStart ?? null,
        periodEnd: data.periodEnd ?? null,
        categoryId: data.categoryId ?? null,
        status: data.status,
        provenanceType: "manual",
        attestationRecordId: attestationId,
        createdBy: user_id,
      });

      // Insert audit_log
      await tx.insert(auditLog).values({
        logId: uuidv7(),
        companyId: company_id,
        entityType: "observation",
        entityId: observationId,
        action: `manual_observation_${attestationAction}`,
        actorId: user_id,
        metadata: {
          label: data.label,
          normalizedKey: data.normalizedKey,
          status: data.status,
          attestationRecordId: attestationId,
        },
      });

      return { observationId, attestationId, status: data.status };
    });

    if ("error" in result) {
      return NextResponse.json({
        code: result.error,
        field: (result as any).field,
        message: (result as any).message,
      }, { status: 422 });
    }

    // After commit, if status approved enqueue semantic-conflict-job
    if (result.status === "approved") {
      await semanticConflictQueue.add(
        "semantic-conflict",
        { observationId: result.observationId, companyId: company_id },
        { jobId: `sc-${result.observationId}`, attempts: 3, backoff: { type: "exponential", delay: 2000 } }
      );
    }
    // TODO: verify - POST /api/observations/manual with status=approved enqueues semantic-conflict-job

    return NextResponse.json(
      {
        id: result.observationId,
        status: result.status,
        attestationRecordId: result.attestationId,
      } satisfies ManualObservationResponse,
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/observations/manual] Error:", err);
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "Internal server error" }, { status: 500 });
  }
}
