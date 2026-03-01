import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";

const pool = new Pool({ connectionString: env.DATABASE_URL, min: 2, max: 10 });
pool.on("release", (client: any) => {
  if (client) {
    void client.query("RESET app.current_company_id").catch(() => undefined);
  }
});

export const db = drizzle(pool);
export { pool };
