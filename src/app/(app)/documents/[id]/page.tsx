import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documents, documentVersions } from "@/lib/db/schema/documents";
import { observations } from "@/lib/db/schema/observations";
import { evidenceBlocks } from "@/lib/db/schema/evidence";
import { eq, and, desc, inArray } from "drizzle-orm";
import Link from "next/link";
import DocumentSplitView from "@/components/documents/DocumentSplitView";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const { company_id } = session.user;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  let document: any = null;
  let observationList: any[] = [];
  let evidenceBlockList: any[] = [];

  try {
    const result = await withTenant(db, company_id, async (tx) => {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.documentId, id), eq(documents.companyId, company_id)))
        .limit(1);

      if (!doc) return null;

      const [latestVersion] = await tx
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, id),
            eq(documentVersions.companyId, company_id)
          )
        )
        .orderBy(desc(documentVersions.createdAt))
        .limit(1);

      if (!latestVersion) return { doc, latestVersion: null, obs: [], blocks: [] };

      // Fetch candidate observations for this document version
      const obs = await tx
        .select({
          observationId: observations.observationId,
          label: observations.label,
          normalizedKey: observations.normalizedKey,
          value: observations.value,
          numericValue: observations.numericValue,
          unit: observations.unit,
          dataType: observations.dataType,
          timeBehavior: observations.timeBehavior,
          periodStart: observations.periodStart,
          periodEnd: observations.periodEnd,
          status: observations.status,
          confidenceScore: observations.confidenceScore,
          evidenceBlockIds: observations.evidenceBlockIds,
          categoryId: observations.categoryId,
          createdAt: observations.createdAt,
        })
        .from(observations)
        .where(
          and(
            eq(observations.sourceDocumentVersionId, latestVersion.documentVersionId),
            eq(observations.companyId, company_id),
            eq(observations.status, "candidate")
          )
        )
        .limit(50);

      // Collect all unique evidence block IDs
      const seenIds = new Set<string>();
      for (const o of obs) {
        for (const bid of (o.evidenceBlockIds ?? [])) {
          seenIds.add(bid);
        }
      }
      const allBlockIds: string[] = [...seenIds];

      let blocks: any[] = [];
      if (allBlockIds.length > 0) {
        blocks = await tx
          .select({
            blockId: evidenceBlocks.blockId,
            pageNumber: evidenceBlocks.pageNumber,
            bbox: evidenceBlocks.bbox,
            text: evidenceBlocks.text,
            blockType: evidenceBlocks.blockType,
          })
          .from(evidenceBlocks)
          .where(
            and(
              inArray(evidenceBlocks.blockId, allBlockIds as [string, ...string[]]),
              eq(evidenceBlocks.documentVersionId, latestVersion.documentVersionId),
              eq(evidenceBlocks.companyId, company_id)
            )
          );
      }

      return { doc, latestVersion, obs, blocks };
    });

    if (!result) notFound();

    document = {
      id: result.doc.documentId,
      title: result.doc.title,
      originalFilename: result.latestVersion?.originalFilename ?? result.doc.title,
      categoryId: result.doc.categoryId,
      latestVersion: result.latestVersion
        ? {
            id: result.latestVersion.documentVersionId,
            pipelineStatus: result.latestVersion.pipelineStatus,
            pageCount: result.latestVersion.pageCount,
            sizeBytes: result.latestVersion.fileSizeBytes,
            objectKey: result.latestVersion.objectKey,
            createdAt: result.latestVersion.createdAt?.toISOString(),
          }
        : null,
    };

    observationList = result.obs.map((o: any) => ({
      id: o.observationId,
      label: o.label,
      normalizedKey: o.normalizedKey,
      value: o.value,
      unit: o.unit,
      confidenceScore: o.confidenceScore,
      status: o.status,
      evidenceBlockIds: o.evidenceBlockIds ?? [],
    }));

    evidenceBlockList = result.blocks.map((b: any) => ({
      id: b.blockId,
      pageNumber: b.pageNumber,
      bbox:
        Array.isArray(b.bbox) && b.bbox.length >= 4
          ? { x1: b.bbox[0], y1: b.bbox[1], x2: b.bbox[2], y2: b.bbox[3] }
          : { x1: 0, y1: 0, x2: 0, y2: 0 },
      textContent: b.text,
      ocrConfidence: 1,
    }));
  } catch (err) {
    console.error("[DocumentDetailPage] Error:", err);
  }

  if (!document) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Document introuvable</p>
        <Link href="/documents" className="mt-4 text-sm text-accent hover:underline">
          Retour aux documents
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground font-serif">
            {document.originalFilename}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Détails du document
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href={`/documents/${id}/review`}
            className="text-accent hover:underline"
          >
            File de révision
          </Link>
          <Link href="/documents" className="text-sm text-accent hover:underline">
            ← Retour
          </Link>
        </div>
      </div>

      {observationList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card py-16">
          <p className="text-muted-foreground">Aucune observation candidate pour ce document</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Les observations apparaîtront une fois l&apos;extraction terminée.
          </p>
        </div>
      ) : (
        <DocumentSplitView
          documentId={document.id}
          pageCount={document.latestVersion?.pageCount ?? 0}
          observations={observationList}
          evidenceBlocks={evidenceBlockList}
        />
      )}
    </div>
  );
}
