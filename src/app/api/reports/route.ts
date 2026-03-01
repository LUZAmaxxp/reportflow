import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { reports } from "@/lib/db/schema/reports";
import { eq, and, desc } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RISK-15 resolution: html_snapshot_url explicitly excluded from list response
export type ReportListItem = {
  report_id: string;
  version: number;
  status: "draft" | "final";
  language: string;
  generated_at: string;
  client_id: string | null;
  source_report_id: string | null;
};

/**
 * GET /api/reports — List reports without html snapshot URL.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json(
      { code: "unauthorized", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { company_id } = session.user;
  const searchParams = req.nextUrl.searchParams;

  const clientId = searchParams.get("client_id") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);

  if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > 100) {
    return NextResponse.json(
      { code: "invalid_query", message: "Invalid pagination params" },
      { status: 422 }
    );
  }

  if (status && !["draft", "final"].includes(status)) {
    return NextResponse.json(
      { code: "invalid_query", message: "status must be draft or final" },
      { status: 422 }
    );
  }

  if (clientId && !UUID_RE.test(clientId)) {
    return NextResponse.json(
      { code: "invalid_query", message: "client_id must be a valid UUID" },
      { status: 422 }
    );
  }

  const offset = (page - 1) * limit;

  const result = await withTenant(db, company_id, async (tx) => {
    const conditions: any[] = [eq(reports.companyId, company_id)];

    if (clientId) {
      conditions.push(eq(reports.clientId, clientId));
    }

    if (status) {
      conditions.push(eq(reports.status, status as "draft" | "final"));
    }

    const rows = await tx
      .select({
        report_id: reports.reportId,
        version: reports.version,
        status: reports.status,
        language: reports.language,
        generated_at: reports.generatedAt,
        client_id: reports.clientId,
        source_report_id: reports.sourceReportId,
      })
      .from(reports)
      .where(and(...conditions))
      .orderBy(desc(reports.generatedAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r: typeof rows[number]): ReportListItem => ({
      report_id: r.report_id,
      version: r.version,
      status: r.status,
      language: r.language,
      generated_at: r.generated_at?.toISOString?.() ?? String(r.generated_at),
      client_id: r.client_id,
      source_report_id: r.source_report_id,
    }));
  });

  return NextResponse.json({
    data: result,
    page,
    pageSize: limit,
  });
}
