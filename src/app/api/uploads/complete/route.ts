import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadCompleteSchema, mapValidationError } from "@/lib/uploads/validate";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { pipelineRuns } from "@/lib/db/schema/pipeline";
import { r2Client, R2_BUCKET } from "@/lib/r2";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { ocrQueue } from "@/lib/queues";
import { publishPipelineEvent, nextEventId } from "@/lib/pipeline/pubsub";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.user_id) {
    return NextResponse.json({ code: "unauthorized", message: "Authentication required" }, { status: 401 });
  }

  const { user_id, company_id, role } = session.user;

  if (role === "viewer") {
    return NextResponse.json({ code: "forbidden", message: "Viewers cannot upload" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ code: "validation_error", message: "Invalid JSON" }, { status: 422 });
  }

  const parsed = uploadCompleteSchema.safeParse(body);
  if (!parsed.success) {
    const error = mapValidationError(parsed.error);
    return NextResponse.json(error, { status: 422 });
  }

  const { objectKey, filename, pageCount, categoryId, clientId } = parsed.data;

  // Company prefix guard
  if (!objectKey.startsWith(`${company_id}/`)) {
    return NextResponse.json(
      { code: "invalid_object_key", message: "Object key does not match tenant" },
      { status: 422 }
    );
  }

  // R2 HEAD existence check
  try {
    await r2Client.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: objectKey })
    );
  } catch {
    return NextResponse.json(
      { code: "object_not_found", message: "Object not found in storage" },
      { status: 422 }
    );
  }

  // Idempotency check
  // SPEC DEVIATION: duplicate objectKey response code — Edge-case table mentions 409 while endpoint contract and acceptance require idempotent 200; implementation follows contract+acceptance and returns 200
  const existingVersions = await withTenant(db, company_id, async (tx) => {
    return tx
      .select({
        documentVersionId: documentVersions.documentVersionId,
        documentId: documentVersions.documentId,
        pipelineStatus: documentVersions.pipelineStatus,
      })
      .from(documentVersions)
      .where(eq(documentVersions.objectKey, objectKey))
      .limit(1);
  });

  if (existingVersions.length > 0) {
    const existing = existingVersions[0];
    return NextResponse.json({
      documentId: existing.documentId,
      documentVersionId: existing.documentVersionId,
      pipelineStatus: existing.pipelineStatus,
      code: "idempotent_replay",
    }, { status: 200 });
  }

  // Create document and version
  const result = await withTenant(db, company_id, async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        companyId: company_id,
        title: filename,
        categoryId: categoryId ?? undefined,
        createdBy: user_id,
      })
      .returning({ documentId: documents.documentId });

    // Compute file size from R2 HEAD (we already confirmed it exists)
    let fileSizeBytes = 0;
    try {
      const headResult = await r2Client.send(
        new HeadObjectCommand({ Bucket: R2_BUCKET, Key: objectKey })
      );
      fileSizeBytes = headResult.ContentLength ?? 0;
    } catch {
      // fallback
    }

    const [version] = await tx
      .insert(documentVersions)
      .values({
        documentId: doc.documentId,
        companyId: company_id,
        fileHash: objectKey, // use objectKey as initial hash
        objectKey,
        originalFilename: filename,
        pageCount,
        fileSizeBytes,
        pipelineStatus: "uploaded",
        createdBy: user_id,
      })
      .returning({
        documentVersionId: documentVersions.documentVersionId,
        pipelineStatus: documentVersions.pipelineStatus,
      });

    // Insert pipeline run
    await tx
      .insert(pipelineRuns)
      .values({
        documentVersionId: version.documentVersionId,
        companyId: company_id,
        status: "running",
      });

    return {
      documentId: doc.documentId,
      documentVersionId: version.documentVersionId,
      pipelineStatus: version.pipelineStatus,
    };
  });

  // Enqueue OCR job
  await ocrQueue.add(
    "process-ocr-document-version",
    {
      documentVersionId: result.documentVersionId,
      companyId: company_id,
    },
    { attempts: 2, backoff: { type: "exponential", delay: 1000 } }
  );

  // Publish SSE event
  await publishPipelineEvent(company_id, {
    id: nextEventId(),
    type: "pipeline_stage_changed",
    documentVersionId: result.documentVersionId,
    documentId: result.documentId,
    pipelineStatus: "uploaded",
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      documentId: result.documentId,
      documentVersionId: result.documentVersionId,
      pipelineStatus: result.pipelineStatus,
    },
    { status: 201 }
  );
}
