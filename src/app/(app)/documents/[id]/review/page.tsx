import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { observations } from "@/lib/db/schema/observations";
import { eq, and, desc, sql } from "drizzle-orm";
import Link from "next/link";
import ReviewQueueTabs from "@/components/observations/ReviewQueueTabs";

const ALLOWED_TABS = ["candidate", "approved", "rejected"] as const;
type TabValue = (typeof ALLOWED_TABS)[number];

function isAllowedTab(val: string): val is TabValue {
  return (ALLOWED_TABS as readonly string[]).includes(val);
}

export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const sp = await searchParams;
  const { company_id } = session.user;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const currentTab: TabValue = sp.tab && isAllowedTab(sp.tab) ? sp.tab : "candidate";
  const currentPage = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const limit = 20;

  let documentData: any = null;
  let observationRows: any[] = [];
  let total = 0;
  let tabCounts: Record<TabValue, number> = { candidate: 0, approved: 0, rejected: 0 };

  try {
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

      if (!latestVersion) {
        return {
          doc,
          latestVersion: null,
          obs: [],
          total: 0,
          counts: { candidate: 0, approved: 0, rejected: 0 },
        };
      }

      // Get tab counts
      const countResults = await tx
        .select({
          status: observations.status,
          count: sql<number>`count(*)::int`,
        })
        .from(observations)
        .where(
          and(
            eq(observations.sourceDocumentVersionId, latestVersion.documentVersionId),
            eq(observations.companyId, company_id)
          )
        )
        .groupBy(observations.status);

      const counts: Record<TabValue, number> = { candidate: 0, approved: 0, rejected: 0 };
      for (const row of countResults) {
        if (row.status && row.status in counts) {
          counts[row.status as TabValue] = row.count;
        }
      }

      // Get observations for current tab with pagination
      const offset = (currentPage - 1) * limit;
      const obs = await tx
        .select({
          observationId: observations.observationId,
          label: observations.label,
          normalizedKey: observations.normalizedKey,
          value: observations.value,
          numericValue: observations.numericValue,
          unit: observations.unit,
          dataType: observations.dataType,
          timeBehavior: observations.timeBehavior,
          periodStart: observations.periodStart,
          periodEnd: observations.periodEnd,
          status: observations.status,
          confidenceScore: observations.confidenceScore,
          evidenceBlockIds: observations.evidenceBlockIds,
          categoryId: observations.categoryId,
          createdAt: observations.createdAt,
        })
        .from(observations)
        .where(
          and(
            eq(observations.sourceDocumentVersionId, latestVersion.documentVersionId),
            eq(observations.companyId, company_id),
            eq(observations.status, currentTab)
          )
        )
        .orderBy(desc(observations.confidenceScore))
        .limit(limit)
        .offset(offset);

      return {
        doc,
        latestVersion,
        obs,
        total: counts[currentTab],
        counts,
      };
    });

    if (!result) notFound();

    documentData = {
      id: result.doc.documentId,
      title: result.doc.title,
      originalFilename: result.latestVersion?.originalFilename ?? result.doc.title,
    };

    observationRows = result.obs.map((o: any) => ({
      id: o.observationId,
      label: o.label,
      normalizedKey: o.normalizedKey,
      value: o.value,
      unit: o.unit,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      confidenceScore: o.confidenceScore,
      status: o.status,
      categoryId: o.categoryId,
      evidenceBlockIds: o.evidenceBlockIds ?? [],
    }));

    total = result.total;
    tabCounts = result.counts;
  } catch (err) {
    console.error("[ReviewQueuePage] Error:", err);
  }

  if (!documentData) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Document introuvable</p>
        <Link href="/documents" className="mt-4 text-sm text-primary hover:underline">
          Retour aux documents
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            File de révision
          </h1>
          <p className="text-sm text-muted-foreground">
            {documentData.originalFilename}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href={`/documents/${id}`}
            className="text-primary hover:underline"
          >
            Vue détail
          </Link>
          <Link href="/documents" className="text-sm text-primary hover:underline">
            ← Retour
          </Link>
        </div>
      </div>

      <ReviewQueueTabs
        documentId={id}
        initialRows={observationRows}
        currentTab={currentTab}
        counts={tabCounts}
        total={total}
        page={currentPage}
        pageSize={limit}
        categories={[]}
      />
    </div>
  );
}
