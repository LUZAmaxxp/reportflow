import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { observations } from "@/lib/db/schema/observations";
import { documentCategories } from "@/lib/db/schema/documents";
import { eq, and, ilike, gte, lte, desc, asc, sql } from "drizzle-orm";
import Link from "next/link";
import ObservationFilterPanel from "@/components/observations/ObservationFilterPanel";
import ObservationCard from "@/components/observations/ObservationCard";
import ManualObservationTrigger from "@/components/observations/ManualObservationTrigger";

const VALID_STATUSES = ["candidate", "approved", "rejected", "superseded", "invalidated"] as const;
const VALID_SORTS = ["confidence_score:desc", "confidence_score:asc", "created_at:desc", "created_at:asc"] as const;

export default async function ObservationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    normalizedKey?: string;
    categoryId?: string;
    q?: string;
    periodStart?: string;
    periodEnd?: string;
    page?: string;
    limit?: string;
    sort?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const { company_id } = session.user;

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(sp.limit ?? "20", 10) || 20));
  const offset = (page - 1) * limit;

  let observationList: any[] = [];
  let total = 0;
  let categories: any[] = [];

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      // Fetch categories for filter panel
      const cats = await tx
        .select({
          categoryId: documentCategories.categoryId,
          name: documentCategories.name,
          path: documentCategories.path,
          parentCategoryId: documentCategories.parentCategoryId,
          sortOrder: documentCategories.sortOrder,
        })
        .from(documentCategories)
        .where(eq(documentCategories.companyId, company_id))
        .orderBy(asc(documentCategories.path), asc(documentCategories.sortOrder));

      // Build conditions
      const conditions: any[] = [eq(observations.companyId, company_id)];

      if (sp.status && (VALID_STATUSES as readonly string[]).includes(sp.status)) {
        conditions.push(eq(observations.status, sp.status as any));
      }

      if (sp.normalizedKey) {
        conditions.push(eq(observations.normalizedKey, sp.normalizedKey));
      }

      if (sp.categoryId) {
        conditions.push(eq(observations.categoryId, sp.categoryId));
      }

      if (sp.q) {
        conditions.push(ilike(observations.label, `%${sp.q}%`));
      }

      if (sp.periodStart) {
        conditions.push(gte(observations.periodStart, sp.periodStart));
      }

      if (sp.periodEnd) {
        conditions.push(lte(observations.periodEnd, sp.periodEnd));
      }

      const whereClause = and(...conditions);

      // Count
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(observations)
        .where(whereClause);

      // Determine sort
      let orderBy: any;
      switch (sp.sort) {
        case "confidence_score:asc":
          orderBy = asc(observations.confidenceScore);
          break;
        case "created_at:desc":
          orderBy = desc(observations.createdAt);
          break;
        case "created_at:asc":
          orderBy = asc(observations.createdAt);
          break;
        default:
          orderBy = desc(observations.confidenceScore);
      }

      const rows = await tx
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
          categoryId: observations.categoryId,
          sourceDocumentVersionId: observations.sourceDocumentVersionId,
          createdAt: observations.createdAt,
        })
        .from(observations)
        .where(whereClause)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      return {
        cats,
        rows,
        total: countRow?.count ?? 0,
      };
    });

    categories = result.cats;
    observationList = result.rows.map((o: any) => ({
      ...o,
      createdAt: o.createdAt?.toISOString(),
    }));
    total = result.total;
  } catch (err) {
    console.error("[ObservationsPage] Error:", err);
  }

  const totalPages = Math.ceil(total / limit);
  const hasFilters = !!(sp.status || sp.normalizedKey || sp.categoryId || sp.q || sp.periodStart || sp.periodEnd);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground font-serif">
            Observations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} observation{total !== 1 ? "s" : ""} trouvée{total !== 1 ? "s" : ""}
          </p>
        </div>
        <ManualObservationTrigger />
      </div>

      <div className="flex gap-6">
        {/* Filter sidebar */}
        <div className="w-64 shrink-0">
          <ObservationFilterPanel categories={categories} />
        </div>

        {/* Observation grid */}
        <div className="flex-1 space-y-4">
          {observationList.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16">
              <p className="text-muted-foreground">Aucune observation trouvée</p>
              {hasFilters && (
                <Link
                  href="/observations"
                  className="mt-2 text-sm text-accent hover:underline"
                >
                  Réinitialiser les filtres
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {observationList.map((obs) => (
                  <ObservationCard key={obs.observationId} observation={obs} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  {page > 1 && (
                    <Link
                      href={buildUrl(sp, { page: String(page - 1) })}
                      className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
                    >
                      Précédent
                    </Link>
                  )}
                  <span className="text-sm text-muted-foreground">
                    Page {page} sur {totalPages}
                  </span>
                  {page < totalPages && (
                    <Link
                      href={buildUrl(sp, { page: String(page + 1) })}
                      className="rounded-md border px-3 py-1 text-sm hover:bg-muted"
                    >
                      Suivant
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function buildUrl(
  currentParams: Record<string, string | undefined>,
  overrides: Record<string, string>
): string {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(currentParams)) {
    if (val) params.set(key, val);
  }
  for (const [key, val] of Object.entries(overrides)) {
    params.set(key, val);
  }
  return `/observations?${params.toString()}`;
}
