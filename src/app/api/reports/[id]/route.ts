import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { reports } from "@/lib/db/schema/reports";
import { eq, and } from "drizzle-orm";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/r2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/reports/{id} — Get single report with freshly-presigned URLs.
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

  const report = await withTenant(db, company_id, async (tx) => {
    const [row] = await tx
      .select({
        report_id: reports.reportId,
        version: reports.version,
        status: reports.status,
        language: reports.language,
        generated_at: reports.generatedAt,
        client_id: reports.clientId,
        source_report_id: reports.sourceReportId,
        html_snapshot_r2_key: reports.htmlSnapshotR2Key,
        pdf_r2_key: reports.pdfR2Key,
        reporting_period_start: reports.reportingPeriodStart,
        reporting_period_end: reports.reportingPeriodEnd,
      })
      .from(reports)
      .where(
        and(
          eq(reports.reportId, id),
          eq(reports.companyId, company_id)
        )
      )
      .limit(1);

    return row;
  });

  if (!report) {
    return NextResponse.json(
      { code: "report_not_found", message: "Report not found" },
      { status: 404 }
    );
  }

  // Generate fresh presigned URL for HTML snapshot
  const htmlSnapshotUrl = await getSignedUrl(
    r2Client,
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: report.html_snapshot_r2_key,
    }),
    { expiresIn: 3600 }
  );

  // Generate presigned URL for PDF if it exists
  let pdfUrl: string | null = null;
  if (report.pdf_r2_key) {
    pdfUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: report.pdf_r2_key,
      }),
      { expiresIn: 3600 }
    );
  }

  return NextResponse.json({
    report_id: report.report_id,
    version: report.version,
    status: report.status,
    language: report.language,
    html_snapshot_url: htmlSnapshotUrl,
    pdf_url: pdfUrl,
    source_report_id: report.source_report_id,
    generated_at: report.generated_at?.toISOString?.() ?? String(report.generated_at),
  });
}
