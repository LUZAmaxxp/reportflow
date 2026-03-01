import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { reports } from "@/lib/db/schema/reports";
import { eq, and, sql } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReportVersionItem = {
  report_id: string;
  version: number;
  source_report_id: string | null;
  generated_at: string;
  status: "draft" | "final";
  language: string;
};

/**
 * GET /api/reports/{id}/versions — Return lineage chain for report versions.
 * Uses a recursive CTE to traverse the lineage efficiently in SQL.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { code: "report_not_found", message: "Report not found" },
      { status: 404 }
    );
  }

  const { company_id } = session.user;

  const versions = await withTenant(db, company_id, async (tx) => {
    // Use recursive CTE to find root, then collect full lineage chain
    const result = await tx.execute(sql`
      WITH RECURSIVE
        -- Traverse UP from the given report to find the root
        ancestors AS (
          SELECT report_id, source_report_id, version, generated_at, status, language
          FROM report
          WHERE report_id = ${id} AND company_id = ${company_id}
          UNION ALL
          SELECT r.report_id, r.source_report_id, r.version, r.generated_at, r.status, r.language
          FROM report r
          INNER JOIN ancestors a ON r.report_id = a.source_report_id
          WHERE r.company_id = ${company_id}
        ),
        -- Find the root (the ancestor with no source_report_id)
        root AS (
          SELECT report_id FROM ancestors WHERE source_report_id IS NULL
          LIMIT 1
        ),
        -- Traverse DOWN from root to collect full lineage
        lineage AS (
          SELECT r.report_id, r.source_report_id, r.version, r.generated_at, r.status, r.language
          FROM report r, root
          WHERE r.report_id = root.report_id AND r.company_id = ${company_id}
          UNION ALL
          SELECT r.report_id, r.source_report_id, r.version, r.generated_at, r.status, r.language
          FROM report r
          INNER JOIN lineage l ON r.source_report_id = l.report_id
          WHERE r.company_id = ${company_id}
        )
      SELECT report_id, version, source_report_id, generated_at::text, status, language
      FROM lineage
      ORDER BY version ASC
    `);

    const rows = result.rows as Array<{
      report_id: string;
      version: number;
      source_report_id: string | null;
      generated_at: string;
      status: string;
      language: string;
    }>;

    if (!rows || rows.length === 0) return null;

    return rows.map((r): ReportVersionItem => ({
      report_id: r.report_id,
      version: r.version,
      source_report_id: r.source_report_id,
      generated_at: r.generated_at,
      status: r.status as "draft" | "final",
      language: r.language,
    }));
  });

  if (!versions || versions.length === 0) {
    return NextResponse.json(
      { code: "report_not_found", message: "Lineage root cannot be resolved in tenant scope" },
      { status: 404 }
    );
  }

  return NextResponse.json({ versions });
}
