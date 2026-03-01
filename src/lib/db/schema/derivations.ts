import { pgEnum, pgTable, uuid, text, numeric, boolean, timestamp, index, unique, jsonb } from "drizzle-orm/pg-core";
import { companies } from "./auth";

export const derivationOperationEnum = pgEnum("derivation_operation", ["sum", "average", "delta", "ratio", "count"]);
export const keyEquivalenceResultEnum = pgEnum("key_equivalence_result", ["SAME_KEY", "DIFFERENT_KEY"]);

export const derivationResults = pgTable("derivation_result", {
  resultId: uuid("result_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  label: text("label"),
  operation: derivationOperationEnum("operation").notNull(),
  resultValue: numeric("result_value").notNull(),
  unit: text("unit").notNull(),
  inputObservationIds: uuid("input_observation_ids").array().notNull(),
  coverage: jsonb("coverage").notNull(),
  fingerprintHash: text("fingerprint_hash").notNull(),
  stale: boolean("stale").notNull().default(false),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  derivationCompanyFingerprintUnique: unique("derivation_company_fingerprint_unique").on(table.companyId, table.fingerprintHash),
  derivationCompanyIdx: index("derivation_company_idx").on(table.companyId),
  derivationFingerprintIdx: index("derivation_fingerprint_idx").on(table.fingerprintHash),
  derivationStaleIdx: index("derivation_stale_partial_idx").on(table.companyId, table.stale),
}));

export const keyEquivalenceCache = pgTable("key_equivalence_cache", {
  cacheId: uuid("cache_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  keyPairHash: text("key_pair_hash").notNull().unique(),
  keyA: text("key_a").notNull(),
  keyB: text("key_b").notNull(),
  result: keyEquivalenceResultEnum("result").notNull(),
  rationale: text("rationale").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  keyEquivalenceCreatedIdx: index("key_equivalence_cache_created_at_idx").on(table.createdAt),
}));
