/**
 * Quick test script to re-run extraction for an existing document version
 * without re-uploading. Calls processExtractionJob directly (no queue).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-extraction.ts [documentVersionId] [companyId]
 *
 * If no args are provided, it will auto-detect the latest document version.
 */

import { db } from "@/lib/db";
import { withTenant } from "@/lib/db/rls";
import { documentVersions } from "@/lib/db/schema/documents";
import { observations } from "@/lib/db/schema/observations";
import { eq, and, sql } from "drizzle-orm";
import { processExtractionJob } from "../workers/pipeline/jobs/extraction";

const [argVersionId, argCompanyId] = process.argv.slice(2);

async function run() {
  let documentVersionId = argVersionId;
  let companyId = argCompanyId;

  // Auto-detect latest document version if no args provided
  if (!documentVersionId || !companyId) {
    console.log("No args provided — auto-detecting latest document version...\n");
    const rows: any[] = await db.execute(sql`
      SELECT dv.document_version_id, dv.company_id, dv.pipeline_status, d.title
      FROM document_version dv JOIN document d USING (document_id)
      ORDER BY dv.created_at DESC LIMIT 1
    `) as any;
    const results = Array.isArray(rows) ? rows : (rows as any).rows ?? [];
    if (results.length === 0) {
      console.error("No document versions found in the database.");
      process.exit(1);
    }
    const latest = results[0];
    documentVersionId = latest.document_version_id;
    companyId = latest.company_id;
    console.log(`Found: "${latest.title}" (status: ${latest.pipeline_status})`);
  }

  console.log(`\n=== Test Extraction ===`);
  console.log(`documentVersionId: ${documentVersionId}`);
  console.log(`companyId:         ${companyId}\n`);
  // Reset status to 'embedded' to allow re-extraction
  await withTenant(db, companyId, async (tx) => {
    await tx
      .update(documentVersions)
      .set({
        pipelineStatus: "embedded" as any,
        pipelineStatusUpdatedAt: new Date(),
        pipelineErrorMessage: null,
      })
      .where(eq(documentVersions.documentVersionId, documentVersionId));

    // Delete previous candidate observations from this version so we start clean
    const deleted = await tx
      .delete(observations)
      .where(
        and(
          eq(observations.sourceDocumentVersionId, documentVersionId),
          eq(observations.companyId, companyId)
        )
      )
      .returning({ id: observations.observationId });
    
    console.log(`Cleaned up ${deleted.length} previous observations`);
  });

  // Create a fake BullMQ Job object
  const fakeJob = {
    data: { documentVersionId, companyId },
    id: "test-extraction-manual",
    name: "extraction-job",
    log: (msg: string) => console.log(`[Job] ${msg}`),
    updateProgress: () => {},
  } as any;

  await processExtractionJob(fakeJob);
  console.log("\n=== Done ===\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("Test extraction failed:", err);
  process.exit(1);
});
