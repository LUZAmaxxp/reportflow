import { pgEnum, pgTable, uuid, text, varchar, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { companies, users } from "./auth";

export const notificationTypeEnum = pgEnum("notification_type", ["pipeline_completed", "pipeline_failed", "conflict_detected", "conflict_resolved", "report_ready", "manual_obs_requested", "pipeline_done"]);
// SPEC DEVIATION: chat_role enum reconciles to assistant/tool roles instead of legacy agent/system to match MCP + LLM message model
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant", "tool"]);
export const chatMessageTypeEnum = pgEnum("chat_message_type", ["user_text", "agent_text", "agent_tool_call", "manual_obs_request", "report_ready", "error"]);

export const chatSessions = pgTable("chat_session", {
  sessionId: uuid("session_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.userId, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  chatSessionUserCreatedDescIdx: index("chat_session_user_created_desc_idx").on(table.userId, table.createdAt),
  chatSessionCompanyIdx: index("chat_session_company_idx").on(table.companyId),
}));

export const chatMessages = pgTable("chat_message", {
  messageId: uuid("message_id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => chatSessions.sessionId, { onDelete: "cascade" }),
  role: chatRoleEnum("role").notNull(),
  type: chatMessageTypeEnum("type").notNull(),
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  chatMessageSessionCreatedAscIdx: index("chat_message_session_created_asc_idx").on(table.sessionId, table.createdAt),
}));

export const notifications = pgTable("notification", {
  notificationId: uuid("notification_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.userId, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  notificationUnreadIdx: index("notification_unread_partial_idx").on(table.companyId, table.userId, table.read),
  notificationCompanyCreatedDescIdx: index("notification_company_created_desc_idx").on(table.companyId, table.createdAt),
}));

export const auditLog = pgTable("audit_log", {
  logId: uuid("log_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  actorId: uuid("actor_id").references(() => users.userId, { onDelete: "set null" }),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
}, (table) => ({
  auditLogEntityIdx: index("audit_log_entity_idx").on(table.entityType, table.entityId),
  auditLogActorIdx: index("audit_log_actor_partial_idx").on(table.actorId),
  auditLogTimestampDescIdx: index("audit_log_timestamp_desc_idx").on(table.timestamp),
}));
