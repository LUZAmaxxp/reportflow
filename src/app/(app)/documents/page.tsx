import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { eq, desc, and, count, inArray } from "drizzle-orm";
import DocumentsPageClient from "./DocumentsPageClient";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; limit?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit ?? "20", 10) || 20));
  const offset = (page - 1) * limit;

  const { company_id } = session.user;

  let data: any[] = [];
  let total = 0;

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      const conditions = [eq(documents.companyId, company_id)];

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
        .orderBy(desc(documents.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ total: totalCount }] = await tx
        .select({ total: count() })
        .from(documents)
        .where(and(...conditions));

      // Get latest versions for paginated docs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docIds = allDocs.map((d: any) => d.documentId as string);
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

      const latestVersionMap = new Map<string, (typeof versions)[0]>();
      for (const v of versions) {
        if (!latestVersionMap.has(v.documentId)) {
          latestVersionMap.set(v.documentId, v);
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = allDocs.map((doc: any) => {
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

      return { data: mapped, total: Number(totalCount) };
    });

    data = result.data;
    total = result.total;
  } catch (err) {
    // Fallback to empty state
    console.error("[DocumentsPage] Error fetching documents:", err);
  }

  return (
    <DocumentsPageClient
      initialDocuments={data}
      total={total}
      page={page}
      pageSize={limit}
      userRole={session.user.role}
    />
  );
}
