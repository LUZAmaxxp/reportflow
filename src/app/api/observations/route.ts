import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations } from "@/lib/db/schema/observations";
import { eq, and, count, desc, ilike, lte, gte, sql } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = ["candidate", "approved", "rejected", "superseded"];
const VALID_SORTS = ["confidence_score:desc"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/observations - Company-wide paginated observations browser.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { company_id } = session.user;
  const searchParams = req.nextUrl.searchParams;

  const status = searchParams.get("status") ?? undefined;
  const normalizedKey = searchParams.get("normalizedKey") ?? undefined;
  const categoryId = searchParams.get("categoryId") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const periodStart = searchParams.get("periodStart") ?? undefined;
  const periodEnd = searchParams.get("periodEnd") ?? undefined;
  const pageParam = searchParams.get("page") ?? "1";
  const limitParam = searchParams.get("limit") ?? "20";
  const sort = searchParams.get("sort") ?? "confidence_score:desc";

  const page = parseInt(pageParam, 10);
  const limit = parseInt(limitParam, 10);

  // Validate inputs
  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
    return NextResponse.json(
      { code: "invalid_query", message: "page must be >= 1, limit must be 1..100" },
      { status: 422 }
    );
  }

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { code: "invalid_query", message: "Invalid status filter" },
      { status: 422 }
    );
  }

  if (categoryId && !UUID_RE.test(categoryId)) {
    return NextResponse.json(
      { code: "invalid_query", message: "categoryId must be a valid UUID" },
      { status: 422 }
    );
  }

  if (!VALID_SORTS.includes(sort)) {
    return NextResponse.json(
      { code: "invalid_query", message: "sort must be confidence_score:desc" },
      { status: 422 }
    );
  }

  if (periodStart && !ISO_DATE_RE.test(periodStart)) {
    return NextResponse.json(
      { code: "invalid_query", message: "periodStart must be YYYY-MM-DD" },
      { status: 422 }
    );
  }

  if (periodEnd && !ISO_DATE_RE.test(periodEnd)) {
    return NextResponse.json(
      { code: "invalid_query", message: "periodEnd must be YYYY-MM-DD" },
      { status: 422 }
    );
  }

  if (periodStart && periodEnd && periodEnd < periodStart) {
    return NextResponse.json(
      { code: "invalid_query", message: "periodEnd must be >= periodStart" },
      { status: 422 }
    );
  }

  const offset = (page - 1) * limit;

  const result = await withTenant(db, company_id, async (tx) => {
    const conditions: any[] = [eq(observations.companyId, company_id)];

    if (status) {
      conditions.push(eq(observations.status, status as any));
    }

    if (normalizedKey) {
      conditions.push(eq(observations.normalizedKey, normalizedKey));
    }

    if (categoryId) {
      conditions.push(eq(observations.categoryId, categoryId));
    }

    if (q) {
      conditions.push(
        sql`(${observations.label} ILIKE ${"%" + q + "%"} OR ${observations.normalizedKey} ILIKE ${"%" + q + "%"})`
      );
    }

    // Period overlap: observation.period_start <= periodEnd && observation.period_end >= periodStart
    if (periodStart) {
      conditions.push(gte(observations.periodEnd, periodStart));
    }
    if (periodEnd) {
      conditions.push(lte(observations.periodStart, periodEnd));
    }

    // Count total
    const [{ total: totalCount }] = await tx
      .select({ total: count() })
      .from(observations)
      .where(and(...conditions));

    // Fetch page, sorted by confidence_score desc
    const rows = await tx
      .select({
        id: observations.observationId,
        label: observations.label,
        normalizedKey: observations.normalizedKey,
        value: observations.value,
        unit: observations.unit,
        dataType: observations.dataType,
        timeBehavior: observations.timeBehavior,
        periodStart: observations.periodStart,
        periodEnd: observations.periodEnd,
        status: observations.status,
        confidenceScore: observations.confidenceScore,
        categoryId: observations.categoryId,
        sourceDocumentVersionId: observations.sourceDocumentVersionId,
        evidenceBlockIds: observations.evidenceBlockIds,
        createdAt: observations.createdAt,
      })
      .from(observations)
      .where(and(...conditions))
      .orderBy(desc(observations.confidenceScore))
      .limit(limit)
      .offset(offset);

    const mapped = rows.map((r: any) => ({
      id: r.id,
      label: r.label,
      normalizedKey: r.normalizedKey,
      value: r.value,
      unit: r.unit || null,
      dataType: r.dataType,
      timeBehavior: r.timeBehavior,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      status: r.status,
      confidenceScore: r.confidenceScore,
      categoryId: r.categoryId,
      sourceDocumentVersionId: r.sourceDocumentVersionId,
      evidenceBlockIds: r.evidenceBlockIds ?? [],
      createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
    }));

    return { data: mapped, total: Number(totalCount) };
  });

  return NextResponse.json({
    data: result.data,
    total: result.total,
    page,
    pageSize: limit,
  });
}
