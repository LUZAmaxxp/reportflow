import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: 1,
  max: 5,
});

pool.on("release", (client: any) => {
  if (client) {
    void client.query("RESET app.current_company_id").catch(() => undefined);
  }
});

export const workerDb = drizzle(pool);
export { pool };
