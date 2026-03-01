import { pgEnum, pgTable, uuid, text, numeric, date, timestamp, real, index, jsonb, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies, users } from "./auth";
import { documentCategories, documentVersions } from "./documents";
import { pipelineRuns } from "./pipeline";
import { chatSessions } from "./notifications";

export const observationStatusEnum = pgEnum("observation_status", ["candidate", "approved", "rejected", "superseded", "invalidated"]);
export const dataTypeEnum = pgEnum("data_type_enum", ["numeric", "percentage", "text", "boolean"]);
export const timeBehaviorEnum = pgEnum("time_behavior_enum", ["periodic", "point_in_time", "none"]);
export const provenanceTypeEnum = pgEnum("provenance_type_enum", ["document", "manual"]);
export const pendingObsStatusEnum = pgEnum("pending_obs_status", ["pending", "confirmed", "skipped", "timed_out"]);

export const attestationRecords = pgTable("attestation_record", {
  attestationId: uuid("attestation_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.userId, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  action: text("action").notNull().default("submitted"),
  note: text("note"),
  sourceReference: text("source_reference"),
  upgradedByObservationId: uuid("upgraded_by_observation_id"),
}, (table) => ({
  attestationCompanyIdx: index("attestation_company_id_idx").on(table.companyId),
  attestationUpgradedIdx: index("attestation_upgraded_partial_idx").on(table.upgradedByObservationId),
}));

export const observations = pgTable("observation", {
  observationId: uuid("observation_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  label: text("label").notNull(),
  normalizedKey: text("normalized_key").notNull(),
  value: text("value").notNull(),
  numericValue: numeric("numeric_value"),
  unit: text("unit").notNull().default(""),
  dataType: dataTypeEnum("data_type").notNull(),
  timeBehavior: timeBehaviorEnum("time_behavior").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  categoryId: uuid("category_id").references(() => documentCategories.categoryId, { onDelete: "set null" }),
  sourceDocumentVersionId: uuid("source_document_version_id").references(() => documentVersions.documentVersionId, { onDelete: "restrict" }),
  status: observationStatusEnum("status").notNull().default("candidate"),
  provenanceType: provenanceTypeEnum("provenance_type").notNull(),
  evidenceBlockIds: uuid("evidence_block_ids").array().notNull().default([]),
  attestationRecordId: uuid("attestation_record_id").references(() => attestationRecords.attestationId, { onDelete: "restrict" }),
  confidenceScore: real("confidence_score"),
  extractionRunId: uuid("extraction_run_id").references(() => pipelineRuns.runId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.userId, { onDelete: "set null" }),
}, (table) => ({
  observationCompanyKeyStatusIdx: index("observation_company_key_status_idx").on(table.companyId, table.normalizedKey, table.status),
  observationCompanyPeriodIdx: index("observation_company_period_idx").on(table.companyId, table.periodStart, table.periodEnd),
  observationSourceDocIdx: index("observation_source_doc_partial_idx").on(table.sourceDocumentVersionId),
  observationCategoryIdx: index("observation_category_partial_idx").on(table.categoryId),
  observationAttestationIdx: index("observation_attestation_partial_idx").on(table.attestationRecordId),
  upgradedByObservationFk: foreignKey({ columns: [attestationRecords.upgradedByObservationId], foreignColumns: [table.observationId] }).onDelete("set null"),
}));

export const pendingManualObservations = pgTable("pending_manual_observation", {
  pendingId: uuid("pending_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull().references(() => chatSessions.sessionId, { onDelete: "cascade" }),
  status: pendingObsStatusEnum("status").notNull().default("pending"),
  prefilled: jsonb("prefilled").notNull().default({}),
  // Back-reference set by POST /confirm after creating the observation — 0008 migration
  observationId: uuid("observation_id").references(() => observations.observationId, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + INTERVAL '10 minutes'`),
}, (table) => ({
  pendingSessionIdx: index("pending_manual_observation_session_idx").on(table.sessionId),
  pendingExpiryIdx: index("pending_manual_observation_expiry_pending_partial_idx").on(table.expiresAt),
  pendingCompanyIdx: index("pending_manual_observation_company_idx").on(table.companyId),
  pendingObsIdx: index("pending_manual_observation_obs_partial_idx").on(table.observationId),
}));
