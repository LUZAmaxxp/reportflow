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

  // Validate UUID
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  const result = await withTenant(db, company_id, async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.documentId, id), eq(documents.companyId, company_id)))
      .limit(1);

    if (!doc) return null;

    const [latestVersion] = await tx
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, id),
          eq(documentVersions.companyId, company_id)
        )
      )
      .orderBy(desc(documentVersions.createdAt))
      .limit(1);

    return {
      id: doc.documentId,
      originalFilename: latestVersion?.originalFilename ?? doc.title,
      categoryId: doc.categoryId,
      clientId: null,
      latestVersion: latestVersion
        ? {
            id: latestVersion.documentVersionId,
            version: 1,
            pipelineStatus: latestVersion.pipelineStatus,
            pageCount: latestVersion.pageCount,
            sizeBytes: latestVersion.fileSizeBytes,
            createdAt: latestVersion.createdAt?.toISOString(),
          }
        : null,
    };
  });

  if (!result) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
