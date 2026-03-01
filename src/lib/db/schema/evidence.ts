import { pgEnum, pgTable, uuid, integer, text, boolean, doublePrecision, date, timestamp, index, customType, foreignKey } from "drizzle-orm/pg-core";
import { companies } from "./auth";
import { documentVersions } from "./documents";

export const blockTypeEnum = pgEnum("block_type", ["paragraph", "table_cell", "header", "list_item", "figure_caption", "other"]);
export const chunkTypeEnum = pgEnum("chunk_type", ["original", "merged", "split", "superseded"]);
export const embeddingStatusEnum = pgEnum("embedding_status_enum", ["pending", "completed", "failed", "skipped"]);

const vector1536 = customType<{ data: number[] }>({
  dataType: () => "vector(1536)",
  toDriver: (value: number[]) => `[${value.join(",")}]`,
  fromDriver: (value: unknown) => {
    if (typeof value === "string") {
      return value.replace(/[\[\]]/g, "").split(",").map(Number);
    }
    return value as number[];
  },
});

export const evidenceBlocks = pgTable("evidence_block", {
  blockId: uuid("block_id").defaultRandom().primaryKey(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.documentVersionId, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.companyId, { onDelete: "cascade" }),
  pageNumber: integer("page_number").notNull(),
  bbox: doublePrecision("bbox").array().notNull(),
  text: text("text").notNull(),
  blockType: blockTypeEnum("block_type").notNull(),
  embedding: vector1536("embedding"),
  lowConfidence: boolean("low_confidence").notNull().default(false),
  ocrConfidence: doublePrecision("ocr_confidence").notNull(),
  chunkType: chunkTypeEnum("chunk_type").notNull().default("original"),
  embeddingStatus: embeddingStatusEnum("embedding_status").notNull().default("pending"),
  mergedBlockIds: uuid("merged_block_ids").array(),
  parentBlockId: uuid("parent_block_id"),
  docDate: date("doc_date"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  site: text("site"),
  supplier: text("supplier"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  evidenceVersionIdx: index("evidence_block_document_version_id_idx").on(table.documentVersionId),
  evidenceCompanyIdx: index("evidence_block_company_id_idx").on(table.companyId),
  evidenceParentIdx: index("evidence_block_parent_block_partial_idx").on(table.parentBlockId),
  parentBlockFk: foreignKey({ columns: [table.parentBlockId], foreignColumns: [table.blockId] }).onDelete("set null"),
}));
