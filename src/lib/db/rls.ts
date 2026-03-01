import { sql } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  db: any,
  companyId: string,
  callback: (tx: any) => Promise<T>
): Promise<T> {
  if (!companyId) throw new Error("withTenant requires a non-empty companyId");
  if (!UUID_RE.test(companyId)) throw new Error("withTenant: companyId must be a valid UUID");
  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql.raw(`SET LOCAL app.current_company_id = '${companyId}'`)
    );
    return callback(tx);
  });
}
