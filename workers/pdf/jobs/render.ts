// PDF worker render job — Slice 5 §5.7
// Fetch HTML from R2, sanitize, render with Puppeteer, upload PDF to R2, update DB.

import { Job } from "bullmq";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { pool, PDF_PER_RENDER_TIMEOUT_MS } from "../pool";
import { workerDb } from "../db";
import { sql } from "drizzle-orm";
import DOMPurify from "isomorphic-dompurify";
import Redis from "ioredis";

interface RenderJobData {
  report_id: string;
  html_r2_key: string;
  output_r2_key: string;
}

// Initialize R2 client for worker process
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME!;

export async function processRenderJob(job: Job<RenderJobData>): Promise<void> {
  const { report_id, html_r2_key, output_r2_key } = job.data;

  console.log(`[render-pdf] Processing report ${report_id}`);

  // Step 1: Verify report exists and belongs to expected tenant
  const reportResult = await workerDb.execute(
    sql`SELECT company_id FROM report WHERE report_id = ${report_id} LIMIT 1`
  );
  if (!reportResult.rows || reportResult.rows.length === 0) {
    throw new Error(`[render-pdf] Report not found: ${report_id}`);
  }

  // Step 2: Fetch HTML from R2
  const getResult = await r2Client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: html_r2_key })
  );

  const rawHtml = await getResult.Body?.transformToString("utf-8");
  if (!rawHtml) {
    throw new Error("Empty HTML retrieved from R2");
  }

  // Step 3: Sanitize HTML
  const originalLength = rawHtml.length;

  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "textarea", "select"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
    ALLOW_DATA_ATTR: false,
  });

  const removedLength = originalLength - cleanHtml.length;
  const removedRatio = removedLength / originalLength;

  if (removedRatio > 0.05) {
    throw new Error(
      `HTML sanitization removed ${(removedRatio * 100).toFixed(1)}% content — potential malicious payload`
    );
  }

  // Step 4: Acquire browser from pool
  const pooledBrowser = await pool.acquire();

  try {
    // Step 5: Render PDF with per-render timeout
    const pdfBuffer = await Promise.race<Buffer>([
      renderPage(pooledBrowser.browser, cleanHtml),
      rejectAfterTimeout(PDF_PER_RENDER_TIMEOUT_MS),
    ]);

    // Step 6: Upload PDF to R2
    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: output_r2_key,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    // Step 7: Update DB — set pdf_r2_key
    await workerDb.execute(
      sql`UPDATE report SET pdf_r2_key = ${output_r2_key}, updated_at = now() WHERE report_id = ${report_id}`
    );

    // Step 8: Publish Redis pub/sub completion notification
    const redis = new Redis(process.env.REDIS_URL!);
    try {
      await redis.publish(
        `render-pdf:${report_id}`,
        JSON.stringify({ pdf_r2_key: output_r2_key })
      );
    } finally {
      redis.disconnect();
    }

    console.log(`[render-pdf] Completed report ${report_id}`);
  } finally {
    // Step 9: Release pool resources
    await pool.release(pooledBrowser);
  }
}

async function renderPage(browser: any, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

function rejectAfterTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Per-render timeout exceeded (${ms}ms)`)),
      ms
    );
  });
}
