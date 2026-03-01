// MCP tool: create_report — Slice 5 §5.7
// Persist report metadata and HTML snapshot in R2.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { reports } from "@/lib/db/schema/reports";
import { observations } from "@/lib/db/schema/observations";
import { derivationResults } from "@/lib/db/schema/derivations";
import { eq, and, inArray } from "drizzle-orm";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, R2_BUCKET } from "@/lib/r2";
import type { AgentContext } from "@/lib/mcp/index";

export const REPORT_HTML_MAX_BYTES = 2097152; // 2 MB

type CreateReportInput = {
  client_id?: string;
  language: string;
  html_content: string;
  observation_ids: string[];
  derivation_result_ids: string[];
  reporting_period_start?: string;
  reporting_period_end?: string;
  source_report_id?: string;
  style_snapshot?: Record<string, unknown> | null;
};

type CreateReportOutput = {
  report_id: string;
  version: number;
  html_snapshot_url: string;
  style_snapshot: Record<string, unknown> | null;
  status: "draft";
};

export async function createReport(
  input: CreateReportInput,
  ctx: AgentContext
): Promise<CreateReportOutput> {
  // Validate HTML size
  const htmlBytes = Buffer.byteLength(input.html_content, "utf-8");
  if (htmlBytes > REPORT_HTML_MAX_BYTES) {
    throw new Error(`HTML content exceeds 2MB limit (${htmlBytes} bytes)`);
  }

  return await withTenant(db, ctx.companyId, async (tx) => {
    // Validate observation_ids — all must be approved and in company scope
    if (input.observation_ids.length > 0) {
      const obs = await tx
        .select({ id: observations.observationId, status: observations.status })
        .from(observations)
        .where(
          and(
            eq(observations.companyId, ctx.companyId),
            inArray(observations.observationId, input.observation_ids)
          )
        );

      if (obs.length !== input.observation_ids.length) {
        throw new Error("Some observation_ids not found in company scope");
      }

      const nonApproved = obs.filter((o: typeof obs[number]) => o.status !== "approved");
      if (nonApproved.length > 0) {
        throw new Error("All observations must be approved for report creation");
      }
    }

    // Validate derivation_result_ids — all must be in company scope
    if (input.derivation_result_ids.length > 0) {
      const derivations = await tx
        .select({ id: derivationResults.resultId })
        .from(derivationResults)
        .where(
          and(
            eq(derivationResults.companyId, ctx.companyId),
            inArray(derivationResults.resultId, input.derivation_result_ids)
          )
        );

      if (derivations.length !== input.derivation_result_ids.length) {
        throw new Error("Some derivation_result_ids not found in company scope");
      }
    }

    // Determine version for source_report_id
    let version = 1;
    if (input.source_report_id) {
      const [source] = await tx
        .select({ version: reports.version })
        .from(reports)
        .where(
          and(
            eq(reports.reportId, input.source_report_id),
            eq(reports.companyId, ctx.companyId)
          )
        )
        .limit(1);

      if (source) {
        version = source.version + 1;
      }
    }

    // Insert report row first to get ID
    const [report] = await tx
      .insert(reports)
      .values({
        companyId: ctx.companyId,
        clientId: input.client_id ?? null,
        version,
        sourceReportId: input.source_report_id ?? null,
        language: input.language,
        status: "draft",
        reportingPeriodStart: input.reporting_period_start ?? null,
        reportingPeriodEnd: input.reporting_period_end ?? null,
        htmlSnapshotR2Key: "pending", // Will be updated after upload
        styleSnapshot: input.style_snapshot ?? null,
        observationIds: input.observation_ids,
        derivationResultIds: input.derivation_result_ids,
        generatedBy: ctx.userId,
      })
      .returning({
        report_id: reports.reportId,
        version: reports.version,
      });

    // Upload HTML to R2
    const r2Key = `${ctx.companyId}/reports/${report.report_id}/snapshot.html`;
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: input.html_content,
        ContentType: "text/html; charset=utf-8",
      })
    );

    // Update report with actual R2 key
    await tx
      .update(reports)
      .set({ htmlSnapshotR2Key: r2Key })
      .where(eq(reports.reportId, report.report_id));

    // Generate presigned URL
    const htmlSnapshotUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }),
      { expiresIn: 3600 }
    );

    return {
      report_id: report.report_id,
      version: report.version,
      html_snapshot_url: htmlSnapshotUrl,
      style_snapshot: input.style_snapshot ?? null,
      status: "draft" as const,
    };
  });
}
