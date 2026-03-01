/**
 * Seed script — creates a test company + admin user.
 *
 * Usage:  npx tsx scripts/seed.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { Client } from "pg";
import bcrypt from "bcryptjs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

async function seed() {
  const client = new Client(DATABASE_URL);
  await client.connect();

  const email = "admin@reportflow.test";
  const password = "Password123!";
  const hash = await bcrypt.hash(password, 10);

  // Upsert company
  const companyRes = await client.query(
    `INSERT INTO company (name)
     VALUES ('ReportFlow Demo')
     ON CONFLICT DO NOTHING
     RETURNING company_id`
  );

  let companyId: string;
  if (companyRes.rows.length > 0) {
    companyId = companyRes.rows[0].company_id;
  } else {
    const existing = await client.query(
      `SELECT company_id FROM company WHERE name = 'ReportFlow Demo' LIMIT 1`
    );
    companyId = existing.rows[0].company_id;
  }

  // Upsert user
  await client.query(
    `INSERT INTO "user" (company_id, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = $3`,
    [companyId, email, hash]
  );

  console.log("Seed complete!");
  console.log(`  Company: ${companyId}`);
  console.log(`  Email:   ${email}`);
  console.log(`  Password: ${password}`);

  await client.end();
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
