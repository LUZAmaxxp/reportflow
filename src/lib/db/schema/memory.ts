import { pgTable, uuid, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { companies, users } from "./auth";
import { clients } from "./documents";

export const preferenceMemoryPointers = pgTable("preference_memory_pointer", {
  pointerId: uuid("pointer_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.clientId, { onDelete: "cascade" }),
  mem0ScopeKey: text("mem0_scope_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  preferencePointerUnique: unique("preference_pointer_company_user_client_unique").on(table.companyId, table.userId, table.clientId),
  preferencePointerUserIdx: index("preference_pointer_user_idx").on(table.userId),
}));
