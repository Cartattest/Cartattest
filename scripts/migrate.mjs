import { readFile } from "node:fs/promises";
import { createPostgresSqlPool } from "../dist/persistence/PostgresSqlPool.js";
import { applyCheckoutSchema, applySchemaMigration } from "../dist/persistence/SchemaMigration.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
const pool = createPostgresSqlPool(databaseUrl);
try {
  const migrations = [
    ["0001_checkout", applyCheckoutSchema],
    ["0002_step_up_sessions", (currentPool, sql) => applySchemaMigration(currentPool, "0002_step_up_sessions", sql)],
    ["0003_evidence_bundles", (currentPool, sql) => applySchemaMigration(currentPool, "0003_evidence_bundles", sql)],
    ["0004_admission_evidence_snapshot", (currentPool, sql) => applySchemaMigration(currentPool, "0004_admission_evidence_snapshot", sql)]
  ];
  let appliedCount = 0;
  for (const [version, apply] of migrations) {
    const schema = await readFile(new URL(`../db/${version}.sql`, import.meta.url), "utf8");
    if (await apply(pool, schema)) {
      process.stdout.write(`Applied ${version}\n`);
      appliedCount++;
    }
  }
  if (appliedCount === 0) process.stdout.write("Database schema is up to date\n");
} finally {
  await pool.end();
}
