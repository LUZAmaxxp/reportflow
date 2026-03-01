import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { r2Client, R2_BUCKET } from "@/lib/r2";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq, and, desc } from "drizzle-orm";

const PIPELINE_OCR_DONE_OR_BEYOND = ["ocr_done", "embedding", "embedded", "extracting", "review_ready"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; pageNumber: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "unauthorized", message: "Authentication required" }, { status: 401 });
  }

  const { company_id } = session.user;
  const { id, pageNumber: pageNumberStr } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  const pageNumber = parseInt(pageNumberStr, 10);
  if (isNaN(pageNumber) || pageNumber < 1) {
    return NextResponse.json({ code: "page_out_of_range", message: "Invalid page number" }, { status: 404 });
  }

  const result = await withTenant(db, company_id, async (tx) => {
    const [doc] = await tx
      .select({ documentId: documents.documentId })
      .from(documents)
      .where(and(eq(documents.documentId, id), eq(documents.companyId, company_id)))
      .limit(1);

    if (!doc) return { error: "document_not_found" as const };

    const [latestVersion] = await tx
      .select({
        documentVersionId: documentVersions.documentVersionId,
        pipelineStatus: documentVersions.pipelineStatus,
        pageCount: documentVersions.pageCount,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, id),
          eq(documentVersions.companyId, company_id)
        )
      )
      .orderBy(desc(documentVersions.createdAt))
      .limit(1);

    if (!latestVersion) return { error: "document_not_found" as const };

    // Check pipeline status >= ocr_done
    if (!PIPELINE_OCR_DONE_OR_BEYOND.includes(latestVersion.pipelineStatus)) {
      return { error: "page_not_ready" as const, currentStatus: latestVersion.pipelineStatus };
    }

    // Check page range
    if (pageNumber > latestVersion.pageCount) {
      return { error: "page_out_of_range" as const };
    }

    return { documentVersionId: latestVersion.documentVersionId };
  });

  if ("error" in result) {
    if (result.error === "document_not_found") {
      return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
    }
    if (result.error === "page_not_ready") {
      return NextResponse.json(
        { code: "page_not_ready", message: "OCR not yet completed", currentStatus: (result as any).currentStatus },
        { status: 404 }
      );
    }
    if (result.error === "page_out_of_range") {
      return NextResponse.json({ code: "page_out_of_range", message: "Page number exceeds page count" }, { status: 404 });
    }
  }

  const documentVersionId = (result as { documentVersionId: string }).documentVersionId;
  const objectKey = `${company_id}/${documentVersionId}/pages/${pageNumber}.png`;

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: objectKey,
  });

  const expiresIn = 3600;
  const pageImageUrl = await getSignedUrl(r2Client, command, { expiresIn });

  return NextResponse.json({ pageImageUrl, expiresIn });
}
