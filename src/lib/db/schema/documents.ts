import { pgEnum, pgTable, text, timestamp, uuid, integer, bigint, boolean, index, foreignKey } from "drizzle-orm/pg-core";
import { companies, users } from "./auth";

export const detectedDocTypeEnum = pgEnum("detected_doc_type", ["sustainability_report", "energy_bill", "hr_report", "financial_statement", "other"]);
export const pipelineStatusEnum = pgEnum("pipeline_status", ["uploaded", "ocr_processing", "ocr_done", "embedding", "embedded", "extracting", "review_ready", "failed"]);

export const clients = pgTable("client", {
  clientId: uuid("client_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.userId, { onDelete: "set null" }),
}, (table) => ({
  clientCompanyIdx: index("client_company_id_idx").on(table.companyId),
}));

export const documentCategories = pgTable("document_category", {
  categoryId: uuid("category_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  parentCategoryId: uuid("parent_category_id"),
  path: text("path").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.userId, { onDelete: "set null" }),
}, (table) => ({
  categoryCompanyIdx: index("document_category_company_id_idx").on(table.companyId),
  categoryParentIdx: index("document_category_parent_id_idx").on(table.parentCategoryId),
  parentCategoryFk: foreignKey({ columns: [table.parentCategoryId], foreignColumns: [table.categoryId] }).onDelete("restrict"),
}));

export const documents = pgTable("document", {
  documentId: uuid("document_id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => documentCategories.categoryId, { onDelete: "set null" }),
  title: text("title").notNull(),
  detectedType: detectedDocTypeEnum("detected_type").notNull().default("other"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.userId, { onDelete: "set null" }),
}, (table) => ({
  documentCompanyIdx: index("document_company_id_idx").on(table.companyId),
  documentCategoryIdx: index("document_category_id_idx").on(table.categoryId),
}));

export const documentVersions = pgTable("document_version", {
  documentVersionId: uuid("document_version_id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => documents.documentId, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  fileHash: text("file_hash").notNull(),
  objectKey: text("object_key").notNull(),
  originalFilename: text("original_filename").notNull(),
  pageCount: integer("page_count").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
  pipelineStatus: pipelineStatusEnum("pipeline_status").notNull().default("uploaded"),
  pipelineStatusUpdatedAt: timestamp("pipeline_status_updated_at", { withTimezone: true }).notNull().defaultNow(),
  pipelineErrorMessage: text("pipeline_error_message"),
  ocrQualityWarning: boolean("ocr_quality_warning").notNull().default(false),
  detectedType: detectedDocTypeEnum("detected_type").notNull().default("other"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.userId, { onDelete: "set null" }),
}, (table) => ({
  versionDocumentIdx: index("document_version_document_id_idx").on(table.documentId),
  versionCompanyIdx: index("document_version_company_id_idx").on(table.companyId),
}));
