import { pgEnum, pgTable, uuid, integer, text, date, jsonb, timestamp, index, foreignKey } from "drizzle-orm/pg-core";
import { companies, users } from "./auth";
import { clients } from "./documents";

export const reportStatusEnum = pgEnum("report_status", ["draft", "final"]);

// SPEC DEVIATION: report html snapshot storage — Stores html_snapshot_r2_key in report table instead of inline html text for scalability
export const reports = pgTable("report", {
  reportId: uuid("report_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.clientId, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  sourceReportId: uuid("source_report_id"),
  language: text("language").notNull(),
  status: reportStatusEnum("status").notNull().default("draft"),
  reportingPeriodStart: date("reporting_period_start"),
  reportingPeriodEnd: date("reporting_period_end"),
  htmlSnapshotR2Key: text("html_snapshot_r2_key").notNull(),
  styleSnapshot: jsonb("style_snapshot"),
  pdfR2Key: text("pdf_r2_key"),
  observationIds: uuid("observation_ids").array().notNull().default([]),
  derivationResultIds: uuid("derivation_result_ids").array().notNull().default([]),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  generatedBy: uuid("generated_by").references(() => users.userId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  reportCompanyIdx: index("report_company_id_idx").on(table.companyId),
  reportClientIdx: index("report_client_partial_idx").on(table.clientId),
  reportSourceIdx: index("report_source_partial_idx").on(table.sourceReportId),
  reportGeneratedDescIdx: index("report_company_generated_desc_idx").on(table.companyId, table.generatedAt),
  sourceReportFk: foreignKey({ columns: [table.sourceReportId], foreignColumns: [table.reportId] }).onDelete("set null"),
}));
