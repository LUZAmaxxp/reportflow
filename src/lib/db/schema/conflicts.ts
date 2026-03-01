import { pgEnum, pgTable, uuid, text, date, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { companies, users } from "./auth";
import { observations } from "./observations";

export const conflictMatchMethodEnum = pgEnum("conflict_match_method", ["exact", "semantic"]);
export const conflictResolutionStatusEnum = pgEnum("conflict_resolution_status", ["auto_resolved", "user_reviewed", "user_overridden"]);

export const conflictCases = pgTable("conflict_case", {
  conflictId: uuid("conflict_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  normalizedKey: text("normalized_key").notNull(),
  conflictGroupId: uuid("conflict_group_id").notNull(),
  matchMethod: conflictMatchMethodEnum("match_method").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  observationIds: uuid("observation_ids").array().notNull(),
  winningObservationId: uuid("winning_observation_id").references(() => observations.observationId, { onDelete: "set null" }),
  autoResolved: boolean("auto_resolved").notNull().default(false),
  resolutionStatus: conflictResolutionStatusEnum("resolution_status").notNull().default("auto_resolved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  conflictCompanyIdx: index("conflict_case_company_id_idx").on(table.companyId),
  conflictCompanyKeyIdx: index("conflict_case_company_key_idx").on(table.companyId, table.normalizedKey),
  conflictGroupIdx: index("conflict_case_group_idx").on(table.conflictGroupId),
  conflictResolutionIdx: index("conflict_case_resolution_idx").on(table.companyId, table.resolutionStatus),
}));

export const conflictResolutions = pgTable("conflict_resolution", {
  resolutionId: uuid("resolution_id").defaultRandom().primaryKey(),
  conflictId: uuid("conflict_id").notNull().references(() => conflictCases.conflictId, { onDelete: "cascade" }),
  chosenObservationId: uuid("chosen_observation_id").notNull().references(() => observations.observationId, { onDelete: "restrict" }),
  resolvedBy: uuid("resolved_by").notNull().references(() => users.userId, { onDelete: "restrict" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason"),
}, (table) => ({
  conflictResolutionConflictIdx: index("conflict_resolution_conflict_id_idx").on(table.conflictId),
}));
