import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations } from "@/lib/db/schema/observations";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { eq, and, count, desc, asc, sql } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = ["candidate", "approved", "rejected"];

/**
 * GET /api/documents/{id}/observations
 * List observations for one document with optional status filter and pagination.
 */
export async function GET(
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

  const { id: documentId } = await params;
  const { company_id } = session.user;

  if (!UUID_RE.test(documentId)) {
    return NextResponse.json(
      { code: "invalid_query", message: "Invalid document id" },
      { status: 422 }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const status = searchParams.get("status") ?? undefined;
  const pageParam = searchParams.get("page") ?? "1";
  const limitParam = searchParams.get("limit") ?? "50";

  const page = parseInt(pageParam, 10);
  const limit = parseInt(limitParam, 10);

  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
    return NextResponse.json(
      { code: "invalid_query", message: "page must be >= 1, limit must be 1..100" },
      { status: 422 }
    );
  }

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { code: "invalid_query", message: "status must be one of candidate|approved|rejected" },
      { status: 422 }
    );
  }

  const offset = (page - 1) * limit;

  const result = await withTenant(db, company_id, async (tx) => {
    // Verify document exists in tenant scope
    const [doc] = await tx
      .select({ documentId: documents.documentId })
      .from(documents)
      .where(
        and(
          eq(documents.documentId, documentId),
          eq(documents.companyId, company_id)
        )
      )
      .limit(1);

    if (!doc) {
      return null;
    }

    // Get the latest document version for this document
    const [latestVersion] = await tx
      .select({ documentVersionId: documentVersions.documentVersionId })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.companyId, company_id)
        )
      )
      .orderBy(desc(documentVersions.createdAt))
      .limit(1);

    if (!latestVersion) {
      return { data: [], total: 0 };
    }

    // Build conditions
    const conditions: any[] = [
      eq(observations.companyId, company_id),
      eq(observations.sourceDocumentVersionId, latestVersion.documentVersionId),
    ];

    if (status) {
      conditions.push(eq(observations.status, status as any));
    }

    // Count total
    const [{ total: totalCount }] = await tx
      .select({ total: count() })
      .from(observations)
      .where(and(...conditions));

    // Fetch page
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
        evidenceBlockIds: observations.evidenceBlockIds,
        createdAt: observations.createdAt,
      })
      .from(observations)
      .where(and(...conditions))
      .orderBy(desc(observations.createdAt))
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
      evidenceBlockIds: r.evidenceBlockIds ?? [],
      createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
    }));

    return { data: mapped, total: Number(totalCount) };
  });

  if (result === null) {
    return NextResponse.json(
      { code: "document_not_found", message: "Document not found or outside tenant scope" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    data: result.data,
    total: result.total,
    page,
    pageSize: limit,
  });
}
