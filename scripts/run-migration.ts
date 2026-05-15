import { config } from "dotenv";
config({ path: ".env.local" });
import { Client } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0011_user_company_rls.sql"),
  "utf8"
);

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  await client.query(sql);
  console.log("Migration 0011 applied OK");
  await client.end();
}

run().catch((e) => {
  console.error("FAILED:", e.message);
  client.end().finally(() => process.exit(1));
});
