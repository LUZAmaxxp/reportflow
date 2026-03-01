import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { pipelineRuns } from "@/lib/db/schema/pipeline";
import { ocrQueue } from "@/lib/queues";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { eq, and, desc } from "drizzle-orm";

const PROCESSING_STATES = ["ocr_processing", "embedding", "extracting"];
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "unauthorized", message: "Authentication required" }, { status: 401 });
  }

  const { user_id, company_id, role } = session.user;

  if (role === "viewer") {
    return NextResponse.json({ code: "forbidden", message: "Viewers cannot retry pipelines" }, { status: 403 });
  }

  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
  }

  const result = await withTenant(db, company_id, async (tx) => {
    const [doc] = await tx
      .select({ documentId: documents.documentId })
      .from(documents)
      .where(and(eq(documents.documentId, id), eq(documents.companyId, company_id)))
      .limit(1);

    if (!doc) return { error: "document_not_found" as const };

    const [latestVersion] = await tx
      .select({
        documentVersionId: documentVersions.documentVersionId,
        pipelineStatus: documentVersions.pipelineStatus,
        pipelineStatusUpdatedAt: documentVersions.pipelineStatusUpdatedAt,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, id),
          eq(documentVersions.companyId, company_id)
        )
      )
      .orderBy(desc(documentVersions.createdAt))
      .limit(1);

    if (!latestVersion) return { error: "document_not_found" as const };

    const { pipelineStatus, pipelineStatusUpdatedAt, documentVersionId } = latestVersion;

    // Allow retry when failed
    const isFailed = pipelineStatus === "failed";

    // Allow retry when stale processing (>10 minutes)
    const isStaleProcessing =
      PROCESSING_STATES.includes(pipelineStatus) &&
      pipelineStatusUpdatedAt &&
      Date.now() - pipelineStatusUpdatedAt.getTime() > STALE_THRESHOLD_MS;

    if (!isFailed && !isStaleProcessing) {
      return { error: "non_retriable_state" as const };
    }

    // Reset to uploaded
    await tx
      .update(documentVersions)
      .set({
        pipelineStatus: "uploaded",
        pipelineErrorMessage: null,
        pipelineStatusUpdatedAt: new Date(),
      })
      .where(eq(documentVersions.documentVersionId, documentVersionId));

    // Insert pipeline run
    await tx
      .insert(pipelineRuns)
      .values({
        documentVersionId,
        companyId: company_id,
        status: "running",
      });

    return { documentVersionId, documentId: doc.documentId };
  });

  if ("error" in result) {
    if (result.error === "document_not_found") {
      return NextResponse.json({ code: "document_not_found", message: "Document not found" }, { status: 404 });
    }
    if (result.error === "non_retriable_state") {
      return NextResponse.json({ code: "non_retriable_state", message: "Pipeline is not in a retriable state" }, { status: 409 });
    }
  }

  const { documentVersionId, documentId } = result as { documentVersionId: string; documentId: string };

  // Enqueue OCR job
  await ocrQueue.add(
    "process-ocr-document-version",
    {
      documentVersionId,
      companyId: company_id,
    },
    { attempts: 2, backoff: { type: "exponential", delay: 1000 } }
  );

  // Publish SSE event
  await publishPipelineEvent(company_id, {
    id: nextEventId(),
    type: "pipeline_stage_changed",
    documentVersionId,
    documentId,
    pipelineStatus: "uploaded",
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({
    documentVersionId,
    pipelineStatus: "uploaded",
  });
}
