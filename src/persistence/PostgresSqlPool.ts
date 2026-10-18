import { Pool } from "pg";
import type { SqlPool } from "./CaptureAttemptRepository.js";

export interface ManagedSqlPool extends SqlPool {
  end(): Promise<void>;
}

export function createPostgresSqlPool(databaseUrl: string): ManagedSqlPool {
  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL_INVALID"); }
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error("DATABASE_URL_INVALID");
  }
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql, values) {
          const result = await client.query(sql, values);
          return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount };
        },
        release() { client.release(); }
      };
    },
    end() { return pool.end(); }
  };
}
