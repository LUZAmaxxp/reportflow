import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documentVersions, documents } from "@/lib/db/schema/documents";
import { conflictCases } from "@/lib/db/schema/conflicts";
import { reports } from "@/lib/db/schema/reports";
import { eq, sql, desc, and, ne } from "drizzle-orm";
import type { DashboardSummaryResponse, PipelineStatus } from "@/types/dashboard";

const ALL_STATUSES: PipelineStatus[] = [
  "uploaded",
  "ocr_processing",
  "ocr_done",
  "embedding",
  "embedded",
  "extracting",
  "review_ready",
  "failed",
];

/**
 * GET /api/dashboard/summary
 * Dashboard aggregate endpoint.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { company_id } = session.user;

  try {
    const result = await withTenant(db, company_id, async (tx: any) => {
      // 1. Documents by status — count document_versions grouped by pipeline_status
      const statusRows = await tx
        .select({
          status: documentVersions.pipelineStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(documentVersions)
        .where(eq(documentVersions.companyId, company_id))
        .groupBy(documentVersions.pipelineStatus);

      const documents_by_status = {} as Record<PipelineStatus, number>;
      for (const s of ALL_STATUSES) {
        documents_by_status[s] = 0;
      }
      for (const row of statusRows) {
        const key = row.status as PipelineStatus;
        if (key in documents_by_status) {
          documents_by_status[key] = row.count;
        }
      }

      // 2. Unresolved conflict count — conflict_case where resolution_status != user_overridden
      const [conflictRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(conflictCases)
        .where(
          and(
            eq(conflictCases.companyId, company_id),
            ne(conflictCases.resolutionStatus, "user_overridden")
          )
        );
      const unresolved_conflict_count = conflictRow?.count ?? 0;

      // 3. Recent documents (limit 5 by created_at desc)
      const recentDocs = await tx
        .select({
          document_id: documents.documentId,
          title: documents.title,
          detected_type: documents.detectedType,
          category_id: documents.categoryId,
          created_at: documents.createdAt,
        })
        .from(documents)
        .where(eq(documents.companyId, company_id))
        .orderBy(desc(documents.createdAt))
        .limit(5);

      const recent_documents = recentDocs.map((d: any) => ({
        document_id: d.document_id,
        title: d.title,
        detected_type: d.detected_type,
        category_id: d.category_id,
        created_at: d.created_at?.toISOString() ?? new Date().toISOString(),
      }));

      // 4. Recent reports (limit 5 by generated_at desc, no html_snapshot_url)
      const recentReps = await tx
        .select({
          report_id: reports.reportId,
          version: reports.version,
          status: reports.status,
          language: reports.language,
          generated_at: reports.generatedAt,
        })
        .from(reports)
        .where(eq(reports.companyId, company_id))
        .orderBy(desc(reports.generatedAt))
        .limit(5);

      const recent_reports = recentReps.map((r: any) => ({
        report_id: r.report_id,
        version: r.version,
        status: r.status,
        language: r.language,
        generated_at: r.generated_at?.toISOString() ?? new Date().toISOString(),
      }));

      return {
        documents_by_status,
        unresolved_conflict_count,
        recent_documents,
        recent_reports,
      } satisfies DashboardSummaryResponse;
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[GET /api/dashboard/summary] Error:", err);
    return NextResponse.json(
      { code: "internal_error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
