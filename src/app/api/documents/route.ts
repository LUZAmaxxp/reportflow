import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { eq, desc, and, ilike, count, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "unauthorized", message: "Authentication required" }, { status: 401 });
  }

  const { company_id } = session.user;
  const searchParams = req.nextUrl.searchParams;

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));
  const status = searchParams.get("status") ?? undefined;
  const categoryId = searchParams.get("categoryId") ?? undefined;
  const q = searchParams.get("q") ?? undefined;

  // Validate status enum if provided
  const validStatuses = ["uploaded", "ocr_processing", "ocr_done", "embedding", "embedded", "extracting", "review_ready", "failed"];
  if (status && !validStatuses.includes(status)) {
    return NextResponse.json({ code: "invalid_query", message: "Invalid status filter" }, { status: 422 });
  }

  // Validate categoryId UUID if provided
  if (categoryId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId)) {
    return NextResponse.json({ code: "invalid_query", message: "categoryId must be a valid UUID" }, { status: 422 });
  }

  const offset = (page - 1) * limit;

  const result = await withTenant(db, company_id, async (tx) => {
    // Build lateral join to get latest version per document
    const latestVersionSubquery = tx
      .select({
        documentId: documentVersions.documentId,
        documentVersionId: documentVersions.documentVersionId,
        pipelineStatus: documentVersions.pipelineStatus,
        pageCount: documentVersions.pageCount,
        fileSizeBytes: documentVersions.fileSizeBytes,
        versionCreatedAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(eq(documentVersions.companyId, company_id))
      .as("lv");

    // We'll query documents with a join on latest version
    const conditions: any[] = [eq(documents.companyId, company_id)];

    if (categoryId) {
      conditions.push(eq(documents.categoryId, categoryId));
    }

    if (q) {
      // Use trgm search on document title
      conditions.push(ilike(documents.title, `%${q}%`));
    }

    // Get all documents matching filters with their latest version
    const allDocs = await tx
      .select({
        documentId: documents.documentId,
        title: documents.title,
        detectedType: documents.detectedType,
        categoryId: documents.categoryId,
        createdAt: documents.createdAt,
        createdBy: documents.createdBy,
      })
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt));

    // Get count
    const [{ total: totalCount }] = await tx
      .select({ total: count() })
      .from(documents)
      .where(and(...conditions));

    // Paginate
    const paginatedDocs = allDocs.slice(offset, offset + limit);

    // Get latest versions for paginated docs
    const docIds = paginatedDocs.map((d: typeof allDocs[number]) => d.documentId);
    const versions =
      docIds.length > 0
        ? await tx
            .select()
            .from(documentVersions)
            .where(
              and(
                inArray(documentVersions.documentId, docIds),
                eq(documentVersions.companyId, company_id)
              )
            )
            .orderBy(desc(documentVersions.createdAt))
        : [];

    // Map latest version per document
    const latestVersionMap = new Map<string, typeof versions[0]>();
    for (const v of versions) {
      if (!latestVersionMap.has(v.documentId)) {
        latestVersionMap.set(v.documentId, v);
      }
    }

    const data = paginatedDocs
      .filter((doc: typeof paginatedDocs[number]) => {
        const lv = latestVersionMap.get(doc.documentId);
        // Filter by status if specified
        if (status && lv && lv.pipelineStatus !== status) return false;
        return true;
      })
      .map((doc: typeof paginatedDocs[number]) => {
        const lv = latestVersionMap.get(doc.documentId);
        return {
          documentId: doc.documentId,
          title: doc.title,
          detectedType: doc.detectedType,
          categoryId: doc.categoryId,
          clientId: null,
          createdAt: doc.createdAt?.toISOString(),
          createdBy: doc.createdBy,
          latestVersion: lv
            ? {
                documentVersionId: lv.documentVersionId,
                pipelineStatus: lv.pipelineStatus,
                pageCount: lv.pageCount,
                fileSizeBytes: lv.fileSizeBytes,
                createdAt: lv.createdAt?.toISOString(),
              }
            : null,
        };
      });

    return { data, total: Number(totalCount) };
  });

  return NextResponse.json({
    data: result.data,
    total: result.total,
    page,
    pageSize: limit,
  });
}
