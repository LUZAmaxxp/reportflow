import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL!);

async function main() {
  const result = await db.execute(sql`SELECT user_id, email, role, created_at FROM "user" ORDER BY created_at`);
  console.log(JSON.stringify(result.rows, null, 2));
  process.exit(0);
}

main();
