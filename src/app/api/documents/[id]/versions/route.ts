import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { eq, and, desc } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "unauthorized", message: "Authentication required" }, { status: 401 });
  }

  const { company_id } = session.user;
  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  const result = await withTenant(db, company_id, async (tx) => {
    // Verify document exists and is accessible
    const [doc] = await tx
      .select({ documentId: documents.documentId })
      .from(documents)
      .where(and(eq(documents.documentId, id), eq(documents.companyId, company_id)))
      .limit(1);

    if (!doc) return null;

    const versions = await tx
      .select({
        documentVersionId: documentVersions.documentVersionId,
        documentId: documentVersions.documentId,
        pipelineStatus: documentVersions.pipelineStatus,
        pageCount: documentVersions.pageCount,
        fileSizeBytes: documentVersions.fileSizeBytes,
        objectKey: documentVersions.objectKey,
        originalFilename: documentVersions.originalFilename,
        pipelineErrorMessage: documentVersions.pipelineErrorMessage,
        ocrQualityWarning: documentVersions.ocrQualityWarning,
        detectedType: documentVersions.detectedType,
        createdAt: documentVersions.createdAt,
        createdBy: documentVersions.createdBy,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, id),
          eq(documentVersions.companyId, company_id)
        )
      )
      .orderBy(desc(documentVersions.createdAt));

    return versions.map((v: typeof versions[number], i: number) => ({
      documentVersionId: v.documentVersionId,
      documentId: v.documentId,
      version: versions.length - i,
      pipelineStatus: v.pipelineStatus,
      pageCount: v.pageCount,
      fileSizeBytes: v.fileSizeBytes,
      objectKey: v.objectKey,
      originalFilename: v.originalFilename,
      pipelineErrorMessage: v.pipelineErrorMessage,
      ocrQualityWarning: v.ocrQualityWarning,
      detectedType: v.detectedType,
      createdAt: v.createdAt?.toISOString(),
      createdBy: v.createdBy,
    }));
  });

  if (!result) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: result,
    total: result.length,
    page: 1,
    pageSize: 20,
  });
}
