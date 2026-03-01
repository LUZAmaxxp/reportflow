import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { eq, and, desc, ne, count, isNotNull, sql } from "drizzle-orm";

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
  const searchParams = req.nextUrl.searchParams;

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));
  const lowConfidenceFilter = searchParams.get("lowConfidence") === "true";
  const includeSuperseeded = searchParams.get("includeSuperseeded") === "true";

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  const offset = (page - 1) * limit;

  const result = await withTenant(db, company_id, async (tx) => {
    // Verify document exists
    const [doc] = await tx
      .select({ documentId: documents.documentId })
      .from(documents)
      .where(and(eq(documents.documentId, id), eq(documents.companyId, company_id)))
      .limit(1);

    if (!doc) return null;

    // Get latest version
    const [latestVersion] = await tx
      .select({ documentVersionId: documentVersions.documentVersionId })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, id),
          eq(documentVersions.companyId, company_id)
        )
      )
      .orderBy(desc(documentVersions.createdAt))
      .limit(1);

    if (!latestVersion) return { data: [], total: 0 };

    // Build conditions
    const conditions: any[] = [
      eq(evidenceBlocks.documentVersionId, latestVersion.documentVersionId),
      eq(evidenceBlocks.companyId, company_id),
    ];

    if (!includeSuperseeded) {
      conditions.push(ne(evidenceBlocks.chunkType, "superseded"));
    }

    if (lowConfidenceFilter) {
      conditions.push(eq(evidenceBlocks.lowConfidence, true));
    }

    // Get total count
    const [{ total: totalCount }] = await tx
      .select({ total: count() })
      .from(evidenceBlocks)
      .where(and(...conditions));

    // Get paginated blocks
    const blocks = await tx
      .select({
        blockId: evidenceBlocks.blockId,
        pageNumber: evidenceBlocks.pageNumber,
        textContent: evidenceBlocks.text,
        ocrConfidence: evidenceBlocks.ocrConfidence,
        lowConfidence: evidenceBlocks.lowConfidence,
        bbox: evidenceBlocks.bbox,
        blockType: evidenceBlocks.blockType,
        chunkType: evidenceBlocks.chunkType,
        embeddingStatus: evidenceBlocks.embeddingStatus,
        embedding: evidenceBlocks.embedding,
      })
      .from(evidenceBlocks)
      .where(and(...conditions))
      .orderBy(evidenceBlocks.pageNumber, evidenceBlocks.blockId)
      .offset(offset)
      .limit(limit);

    return {
      data: blocks.map((b: typeof blocks[number]) => {
        const bboxArray = b.bbox as number[];
        return {
          blockId: b.blockId,
          pageNumber: b.pageNumber,
          textContent: b.textContent,
          ocrConfidence: b.ocrConfidence,
          lowConfidence: b.lowConfidence,
          bbox: {
            x1: bboxArray[0] ?? 0,
            y1: bboxArray[1] ?? 0,
            x2: bboxArray[2] ?? 0,
            y2: bboxArray[3] ?? 0,
          },
          blockType: b.blockType,
          chunkType: b.chunkType,
          hasEmbedding: b.embedding !== null,
          embeddingStatus: b.embeddingStatus,
        };
      }),
      total: Number(totalCount),
    };
  });

  if (!result) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: result.data,
    total: result.total,
    page,
    pageSize: limit,
  });
}
