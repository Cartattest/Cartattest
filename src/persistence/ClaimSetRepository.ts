import canonicalize from "canonicalize";
import { parseClaimSetV1 } from "../api/ClaimSetValidation.js";
import { sha256 } from "../domain/Hash.js";
import type { ClaimSetV1, Sha256 } from "../domain/types.js";
import type { SqlPool } from "./CaptureAttemptRepository.js";

export async function saveClaimSet(pool: SqlPool, value: unknown): Promise<Sha256> {
  const claimSet = parseClaimSetV1(value);
  const canonical = canonicalize(claimSet);
  if (canonical === undefined) throw new Error("INVALID_CLAIM_SET");
  const claimSetHash = await sha256(canonical);
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const inserted = await client.query(
      `INSERT INTO claim_sets (claim_set_id, claim_set_hash, payload, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (claim_set_id) DO NOTHING
       RETURNING claim_set_hash AS "claimSetHash"`,
      [claimSet.claimSetId, claimSetHash, claimSet, claimSet.createdAt, claimSet.expiresAt]
    );
    if (inserted.rows[0]) {
      if (inserted.rows[0].claimSetHash !== claimSetHash) throw new Error("CLAIM_SET_ID_CONFLICT");
    } else {
      const existing = await client.query(
        `SELECT claim_set_hash AS "claimSetHash" FROM claim_sets WHERE claim_set_id = $1 FOR SHARE`,
        [claimSet.claimSetId]
      );
      if (existing.rows[0]?.claimSetHash !== claimSetHash) throw new Error("CLAIM_SET_ID_CONFLICT");
    }
    await client.query("COMMIT");
    inTransaction = false;
    return claimSetHash;
  } catch (error) {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch { /* Keep the original transaction failure. */ }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function loadClaimSet(
  pool: SqlPool,
  claimSetId: string
): Promise<{ claimSet: ClaimSetV1; claimSetHash: Sha256 }> {
  if (typeof claimSetId !== "string" || !claimSetId.trim()) throw new Error("INVALID_CLAIM_SET_ID");
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT payload, claim_set_hash AS "claimSetHash" FROM claim_sets WHERE claim_set_id = $1`,
      [claimSetId]
    );
    if (!result.rows[0]) throw new Error("CLAIM_SET_NOT_FOUND");
    const claimSet = parseClaimSetV1(result.rows[0].payload);
    const canonical = canonicalize(claimSet);
    if (claimSet.claimSetId !== claimSetId || canonical === undefined ||
        await sha256(canonical) !== result.rows[0].claimSetHash) throw new Error("CLAIM_SET_INTEGRITY_FAILURE");
    return { claimSet, claimSetHash: result.rows[0].claimSetHash as Sha256 };
  } finally {
    client.release();
  }
}
