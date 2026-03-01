// MCP tool: render_pdf — Slice 5 §5.7
// Enqueue PDF rendering and await readiness with timeout fallback.

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { reports } from "@/lib/db/schema/reports";
import { eq, and } from "drizzle-orm";
import { renderPdfQueue } from "@/lib/queues";
import { redis } from "@/lib/redis";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/r2";
import Redis from "ioredis";
import { env } from "@/lib/env";
import type { AgentContext } from "@/lib/mcp/index";

export const PDF_RENDER_TIMEOUT_SECONDS = 90;

type RenderPdfInput = { report_id: string };
type RenderPdfOutput = { report_id: string; pdf_url: string } | { error: "render_timeout" };

export async function renderPdf(
  input: RenderPdfInput,
  ctx: AgentContext
): Promise<RenderPdfOutput> {
  // Validate report ownership and html snapshot presence
  const report = await withTenant(db, ctx.companyId, async (tx) => {
    const [row] = await tx
      .select({
        report_id: reports.reportId,
        html_r2_key: reports.htmlSnapshotR2Key,
        pdf_r2_key: reports.pdfR2Key,
      })
      .from(reports)
      .where(
        and(
          eq(reports.reportId, input.report_id),
          eq(reports.companyId, ctx.companyId)
        )
      )
      .limit(1);
    return row;
  });

  if (!report) {
    throw new Error("Report not found in company scope");
  }

  if (!report.html_r2_key || report.html_r2_key === "pending") {
    throw new Error("Report has no HTML snapshot");
  }

  // If PDF already exists, return it
  if (report.pdf_r2_key) {
    const pdfUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: report.pdf_r2_key }),
      { expiresIn: 3600 }
    );
    return { report_id: input.report_id, pdf_url: pdfUrl };
  }

  const outputR2Key = `${ctx.companyId}/reports/${input.report_id}/report.pdf`;

  // Enqueue render job
  await renderPdfQueue.add(
    "render_report_pdf",
    {
      report_id: input.report_id,
      html_r2_key: report.html_r2_key,
      output_r2_key: outputR2Key,
    },
    {
      attempts: 2,
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    }
  );

  // Wait via Redis pub/sub + DB poll fallback up to 90s
  const channel = `render-pdf:${input.report_id}`;
  const subClient = new Redis(env.REDIS_URL);

  try {
    const result = await Promise.race([
      waitForPubSub(subClient, channel),
      pollForPdfKey(input.report_id, ctx.companyId),
      timeout(PDF_RENDER_TIMEOUT_SECONDS * 1000),
    ]);

    if (result === "timeout") {
      return { error: "render_timeout" };
    }

    // Generate presigned URL
    const pdfUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: outputR2Key }),
      { expiresIn: 3600 }
    );

    return { report_id: input.report_id, pdf_url: pdfUrl };
  } finally {
    subClient.unsubscribe(channel).catch(() => {});
    subClient.disconnect();
  }
}

async function waitForPubSub(client: Redis, channel: string): Promise<string> {
  return new Promise((resolve) => {
    client.subscribe(channel, () => {});
    client.on("message", (ch, msg) => {
      if (ch === channel) {
        resolve(msg);
      }
    });
  });
}

async function pollForPdfKey(reportId: string, companyId: string): Promise<string> {
  const maxAttempts = 45; // 90s / 2s interval
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const row = await withTenant(db, companyId, async (tx) => {
      const [r] = await tx
        .select({ pdf_r2_key: reports.pdfR2Key })
        .from(reports)
        .where(
          and(
            eq(reports.reportId, reportId),
            eq(reports.companyId, companyId)
          )
        )
        .limit(1);
      return r;
    });

    if (row?.pdf_r2_key) {
      return row.pdf_r2_key;
    }
  }
  throw new Error("Poll exhausted");
}

function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}
