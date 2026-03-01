import { pgEnum, pgTable, uuid, timestamp, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./auth";
import { documentVersions } from "./documents";

export const pipelineRunStatusEnum = pgEnum("pipeline_run_status", ["running", "completed", "failed"]);

export const pipelineRuns = pgTable("pipeline_run", {
  runId: uuid("run_id").defaultRandom().primaryKey(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.documentVersionId, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: pipelineRunStatusEnum("status").notNull().default("running"),
  observationsCreated: integer("observations_created").notNull().default(0),
  observationsSkipped: integer("observations_skipped").notNull().default(0),
}, (table) => ({
  pipelineRunDocumentVersionIdx: index("pipeline_run_document_version_idx").on(table.documentVersionId),
  pipelineRunCompanyIdx: index("pipeline_run_company_id_idx").on(table.companyId),
  pipelineRunRunningIdx: index("pipeline_run_running_partial_idx").on(table.status),
}));
