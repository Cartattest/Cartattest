import { readFile } from "node:fs/promises";
import { createPostgresSqlPool } from "../dist/persistence/PostgresSqlPool.js";
import { applyCheckoutSchema } from "../dist/persistence/SchemaMigration.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
const pool = createPostgresSqlPool(databaseUrl);
try {
  const schema = await readFile(new URL("../db/0001_checkout.sql", import.meta.url), "utf8");
  const applied = await applyCheckoutSchema(pool, schema);
  process.stdout.write(applied ? "Applied 0001_checkout\n" : "Database schema is up to date\n");
} finally {
  await pool.end();
}
