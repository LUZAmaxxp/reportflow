import type { InferSelectModel, InferInsertModel, Table } from "drizzle-orm";

export type DbSelect<T extends Table> = InferSelectModel<T>;
export type DbInsert<T extends Table> = InferInsertModel<T>;
