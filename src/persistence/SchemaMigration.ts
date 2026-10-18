import type { SqlPool } from "./CaptureAttemptRepository.js";

export async function applyCheckoutSchema(pool: SqlPool, schemaSql: string): Promise<boolean> {
  return applySchemaMigration(pool, "0001_checkout", schemaSql);
}

export async function applySchemaMigration(pool: SqlPool, version: string, schemaSql: string): Promise<boolean> {
  if (!version.trim() || !schemaSql.trim()) throw new Error("SCHEMA_MIGRATION_EMPTY");
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('cart-attest-schema-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const existing = await client.query("SELECT version FROM schema_migrations WHERE version = $1", [version]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      inTransaction = false;
      return false;
    }
    await client.query(schemaSql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    await client.query("COMMIT");
    inTransaction = false;
    return true;
  } catch (error) {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve the migration failure. */ }
    }
    throw error;
  } finally {
    client.release();
  }
}
