import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { reports } from "@/lib/db/schema/reports";
import { chatSessions } from "@/lib/db/schema/notifications";
import { eq, and } from "drizzle-orm";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/r2";
import { agentLoopQueue } from "@/lib/queues";
import { env } from "@/lib/env";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/reports/{id}/regenerate — Trigger report regeneration with optional style memory write.
 */
export async function POST(
  req: NextRequest,
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

  let body: { style_instruction?: string; client_id?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Validate
  if (body.style_instruction && typeof body.style_instruction === "string" && body.style_instruction.length > 500) {
    return NextResponse.json(
      { code: "validation_error", message: "style_instruction must be at most 500 characters" },
      { status: 422 }
    );
  }

  if (body.client_id && !UUID_RE.test(body.client_id)) {
    return NextResponse.json(
      { code: "validation_error", message: "client_id must be a valid UUID" },
      { status: 422 }
    );
  }

  const { user_id, company_id } = session.user;

  // Resolve source report
  const sourceReport = await withTenant(db, company_id, async (tx) => {
    const [row] = await tx
      .select()
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

  if (!sourceReport) {
    return NextResponse.json(
      { code: "report_not_found", message: "Source report not found" },
      { status: 404 }
    );
  }

  // 409 guard: reject if a regeneration job is already active/waiting for this report
  const regenJobId = `regen-${id}`;
  const existingJob = await agentLoopQueue.getJob(regenJobId);
  if (existingJob) {
    const jobState = await existingJob.getState();
    if (jobState === "active" || jobState === "waiting" || jobState === "delayed") {
      return NextResponse.json(
        { code: "generation_in_progress", message: "A regeneration is already in progress for this report" },
        { status: 409 }
      );
    }
  }

  // Optional mem0 write (5s timeout + 1 retry; continue on failure)
  if (body.style_instruction) {
    let mem0Attempts = 0;
    const maxMem0Attempts = 2;
    while (mem0Attempts < maxMem0Attempts) {
      try {
        const scopeKey = [company_id, user_id, body.client_id].filter(Boolean).join(":");
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        await fetch("https://api.mem0.ai/v1/memories/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${env.MEM0_API_KEY}`,
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: body.style_instruction }],
            user_id: scopeKey,
            metadata: { type: "style_preference" },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        break; // success
      } catch (err: any) {
        mem0Attempts++;
        if (mem0Attempts >= maxMem0Attempts) {
          // Continue on mem0 failure — non-blocking
          console.warn("[regenerate] mem0 write failed after retries:", err?.message);
        }
      }
    }
  }

  // Resolve chat session from header or create new one
  const chatSessionId = req.headers.get("X-Chat-Session-Id");
  let sessionId: string;

  if (chatSessionId && UUID_RE.test(chatSessionId)) {
    // Verify ownership
    const owned = await withTenant(db, company_id, async (tx) => {
      const [row] = await tx
        .select({ sessionId: chatSessions.sessionId })
        .from(chatSessions)
        .where(
          and(
            eq(chatSessions.sessionId, chatSessionId),
            eq(chatSessions.userId, user_id)
          )
        )
        .limit(1);
      return !!row;
    });

    if (owned) {
      sessionId = chatSessionId;
    } else {
      // Create new session
      const [newSession] = await withTenant(db, company_id, async (tx) => {
        return tx
          .insert(chatSessions)
          .values({
            companyId: company_id,
            userId: user_id,
            title: "Régénération de rapport",
          })
          .returning({ sessionId: chatSessions.sessionId });
      });
      sessionId = newSession.sessionId;
    }
  } else {
    // Create new session
    const [newSession] = await withTenant(db, company_id, async (tx) => {
      return tx
        .insert(chatSessions)
        .values({
          companyId: company_id,
          userId: user_id,
          title: "Régénération de rapport",
        })
        .returning({ sessionId: chatSessions.sessionId });
    });
    sessionId = newSession.sessionId;
  }

  // Enqueue agent loop job in regenerate mode via BullMQ
  await agentLoopQueue.add(
    "agent-regen",
    {
      session_id: sessionId,
      user_message_id: null,
      mode: "regenerate",
      report_id: id,
      observation_ids: sourceReport.observationIds,
      derivation_result_ids: sourceReport.derivationResultIds,
      language: body.language ?? sourceReport.language ?? "fr",
    },
    { attempts: 1, jobId: regenJobId }
  );

  // Generate presigned URLs for response
  const htmlSnapshotUrl = await getSignedUrl(
    r2Client,
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: sourceReport.htmlSnapshotR2Key,
    }),
    { expiresIn: 3600 }
  );

  let pdfUrl: string | null = null;
  if (sourceReport.pdfR2Key) {
    pdfUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: sourceReport.pdfR2Key,
      }),
      { expiresIn: 3600 }
    );
  }

  return NextResponse.json(
    {
      report_id: id,
      session_id: sessionId,
      html_snapshot_url: htmlSnapshotUrl,
      pdf_url: pdfUrl,
    },
    { status: 202 }
  );
}
