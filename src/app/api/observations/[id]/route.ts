import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations } from "@/lib/db/schema/observations";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { documentCategories } from "@/lib/db/schema/documents";
import { semanticConflictQueue } from "@/lib/queues";
import { QUEUE_NAMES } from "@/lib/constants";
import { eq, and, inArray } from "drizzle-orm";
import type { ObservationStatus } from "@/lib/observations/stateMachine";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ObservationPatchInput {
  label?: string;
  normalizedKey?: string;
  value?: string;
  unit?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  categoryId?: string | null;
}

export interface ObservationDetailResponse {
  id: string;
  label: string;
  normalizedKey: string;
  value: string;
  unit: string | null;
  dataType: "numeric" | "percentage" | "text" | "boolean";
  timeBehavior: "periodic" | "point_in_time" | "none";
  periodStart: string | null;
  periodEnd: string | null;
  numericValue: number | null;
  status: ObservationStatus;
  provenanceType: "document" | "manual";
  confidenceScore: number;
  categoryId: string | null;
  sourceDocumentVersionId: string;
  extractionRunId: string;
  evidenceBlocks: Array<{
    id: string;
    pageNumber: number;
    textContent: string;
    bbox: { x1: number; y1: number; x2: number; y2: number };
    ocrConfidence: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

const patchSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    normalizedKey: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,99}$/, "normalizedKey must match ^[a-z][a-z0-9_]{0,99}$")
      .optional(),
    value: z.string().min(1).max(500).optional(),
    unit: z.string().max(50).nullable().optional(),
    periodStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    periodEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    categoryId: z
      .string()
      .regex(UUID_RE, "categoryId must be a valid UUID")
      .nullable()
      .optional(),
  })
  .strict();

/**
 * Build observation detail response with evidence blocks.
 */
async function buildDetailResponse(
  tx: any,
  obs: any,
  companyId: string
): Promise<ObservationDetailResponse> {
  // Fetch evidence blocks scoped to the document version + company (not full DB)
  const blockIds = obs.evidenceBlockIds ?? [];
  let blocks: ObservationDetailResponse["evidenceBlocks"] = [];

  if (blockIds.length > 0) {
    const blockRows = await tx
      .select({
        id: evidenceBlocks.blockId,
        pageNumber: evidenceBlocks.pageNumber,
        textContent: evidenceBlocks.text,
        bbox: evidenceBlocks.bbox,
        ocrConfidence: evidenceBlocks.ocrConfidence,
      })
      .from(evidenceBlocks)
      .where(
        and(
          inArray(evidenceBlocks.blockId, blockIds),
          eq(evidenceBlocks.documentVersionId, obs.sourceDocumentVersionId),
          eq(evidenceBlocks.companyId, companyId)
        )
      );

    blocks = blockRows.map((b: any) => {
      // bbox is stored as double precision array [x1, y1, x2, y2]
      const bboxArr = b.bbox ?? [0, 0, 0, 0];
      return {
        id: b.id,
        pageNumber: b.pageNumber,
        textContent: b.textContent,
        bbox: {
          x1: bboxArr[0] ?? 0,
          y1: bboxArr[1] ?? 0,
          x2: bboxArr[2] ?? 0,
          y2: bboxArr[3] ?? 0,
        },
        ocrConfidence: b.ocrConfidence,
      };
    });
  }

  return {
    id: obs.observationId,
    label: obs.label,
    normalizedKey: obs.normalizedKey,
    value: obs.value,
    unit: obs.unit || null,
    dataType: obs.dataType,
    timeBehavior: obs.timeBehavior,
    periodStart: obs.periodStart,
    periodEnd: obs.periodEnd,
    numericValue: obs.numericValue ? Number(obs.numericValue) : null,
    status: obs.status,
    provenanceType: obs.provenanceType,
    confidenceScore: obs.confidenceScore,
    categoryId: obs.categoryId,
    sourceDocumentVersionId: obs.sourceDocumentVersionId,
    extractionRunId: obs.extractionRunId,
    evidenceBlocks: blocks,
    createdAt: obs.createdAt?.toISOString?.() ?? obs.createdAt,
    updatedAt: obs.updatedAt?.toISOString?.() ?? obs.updatedAt,
  };
}

/**
 * GET /api/observations/{id} - Single observation detail with evidence blocks.
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

  const { id: obsId } = await params;
  const { company_id } = session.user;

  if (!UUID_RE.test(obsId)) {
    return NextResponse.json(
      { code: "observation_not_found", message: "Observation not found" },
      { status: 404 }
    );
  }

  const result = await withTenant(db, company_id, async (tx) => {
    const [obs] = await tx
      .select()
      .from(observations)
      .where(
        and(
          eq(observations.observationId, obsId),
          eq(observations.companyId, company_id)
        )
      )
      .limit(1);

    if (!obs) return null;

    return buildDetailResponse(tx, obs, company_id);
  });

  if (!result) {
    return NextResponse.json(
      { code: "observation_not_found", message: "Observation not found or outside tenant scope" },
      { status: 404 }
    );
  }

  return NextResponse.json(result);
}

/**
 * PATCH /api/observations/{id} - Edit observation fields.
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
      { code: "forbidden", message: "Viewers cannot edit observations" },
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
      {
        code: "validation_error",
        errors: [{ field: "body", message: "Invalid JSON body" }],
      },
      { status: 422 }
    );
  }

  // Validate with Zod
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json(
      { code: "validation_error", errors },
      { status: 422 }
    );
  }

  const input = parsed.data;

  // Cross-field validation: periodEnd >= periodStart
  if (input.periodStart !== undefined && input.periodEnd !== undefined) {
    if (input.periodStart && input.periodEnd && input.periodEnd < input.periodStart) {
      return NextResponse.json(
        {
          code: "validation_error",
          errors: [{ field: "periodEnd", message: "periodEnd must be >= periodStart" }],
        },
        { status: 422 }
      );
    }
  }

  // Empty object is valid no-op
  const hasChanges = Object.keys(input).length > 0;

  const result = await withTenant(db, company_id, async (tx) => {
    // Fetch current observation
    const [obs] = await tx
      .select()
      .from(observations)
      .where(
        and(
          eq(observations.observationId, obsId),
          eq(observations.companyId, company_id)
        )
      )
      .limit(1);

    if (!obs) return { error: "not_found" as const };

    // Validate categoryId ownership
    if (input.categoryId !== undefined && input.categoryId !== null) {
      const [cat] = await tx
        .select({ categoryId: documentCategories.categoryId })
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.categoryId, input.categoryId),
            eq(documentCategories.companyId, company_id)
          )
        )
        .limit(1);

      if (!cat) {
        return { error: "invalid_category" as const };
      }
    }

    if (hasChanges) {
      const updateData: any = { updatedAt: new Date() };
      if (input.label !== undefined) updateData.label = input.label;
      if (input.normalizedKey !== undefined) updateData.normalizedKey = input.normalizedKey;
      if (input.value !== undefined) updateData.value = input.value;
      if (input.unit !== undefined) updateData.unit = input.unit ?? "";
      if (input.periodStart !== undefined) updateData.periodStart = input.periodStart;
      if (input.periodEnd !== undefined) updateData.periodEnd = input.periodEnd;
      if (input.categoryId !== undefined) updateData.categoryId = input.categoryId;

      await tx
        .update(observations)
        .set(updateData)
        .where(eq(observations.observationId, obsId));

      // If normalizedKey changes on an approved observation, enqueue semantic-conflict-job
      if (
        input.normalizedKey !== undefined &&
        input.normalizedKey !== obs.normalizedKey &&
        obs.status === "approved"
      ) {
        await semanticConflictQueue.add(
          QUEUE_NAMES.SEMANTIC_CONFLICT,
          {
            observationId: obsId,
            companyId: company_id,
            reason: "key_changed",
          },
          {
            attempts: 2,
            backoff: { type: "exponential", delay: 1000 },
          }
        );
      }
    }

    // Re-fetch updated observation
    const [updated] = await tx
      .select()
      .from(observations)
      .where(eq(observations.observationId, obsId))
      .limit(1);

    return { data: await buildDetailResponse(tx, updated, company_id) };
  });

  if (result.error === "not_found") {
    return NextResponse.json(
      { code: "observation_not_found", message: "Observation not found or outside tenant scope" },
      { status: 404 }
    );
  }

  if (result.error === "invalid_category") {
    return NextResponse.json(
      {
        code: "validation_error",
        errors: [{ field: "categoryId", message: "Category not found in tenant scope" }],
      },
      { status: 422 }
    );
  }

  return NextResponse.json(result.data);
}
