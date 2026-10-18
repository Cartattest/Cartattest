import canonicalize from "canonicalize";
import { sha256 } from "../domain/Hash.js";
import type { SqlPool } from "./CaptureAttemptRepository.js";

export async function saveStepUpSession(pool: SqlPool, input: {
  sessionId: string;
  context: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}): Promise<void> {
  if (!nonempty(input.sessionId) || !isRecord(input.context) || !validTime(input.createdAt) || !validTime(input.expiresAt) ||
      Date.parse(input.expiresAt) <= Date.parse(input.createdAt)) throw new Error("INVALID_STEP_UP_SESSION");
  const serialized = canonicalize(input.context);
  if (serialized === undefined) throw new Error("INVALID_STEP_UP_SESSION");
  const contextHash = await sha256(serialized);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO step_up_sessions (session_id, context, context_hash, created_at, expires_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)`,
      [input.sessionId, serialized, contextHash, input.createdAt, input.expiresAt]
    );
  } finally {
    client.release();
  }
}

export async function loadStepUpSession(
  pool: SqlPool,
  sessionId: string,
  now: string
): Promise<Record<string, unknown>> {
  if (!nonempty(sessionId) || !validTime(now)) throw new Error("INVALID_STEP_UP_SESSION");
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT context, context_hash AS "contextHash"
       FROM step_up_sessions
       WHERE session_id = $1 AND consumed_at IS NULL AND expires_at > $2`,
      [sessionId, now]
    );
    const row = result.rows[0];
    if (!row) throw new Error("STEP_UP_SESSION_UNAVAILABLE");
    if (!isRecord(row.context) || typeof row.contextHash !== "string") throw new Error("STEP_UP_SESSION_INTEGRITY_FAILURE");
    const serialized = canonicalize(row.context);
    if (serialized === undefined || await sha256(serialized) !== row.contextHash) {
      throw new Error("STEP_UP_SESSION_INTEGRITY_FAILURE");
    }
    return row.context;
  } finally {
    client.release();
  }
}

export async function consumeStepUpSession(pool: SqlPool, sessionId: string, now: string): Promise<void> {
  if (!nonempty(sessionId) || !validTime(now)) throw new Error("INVALID_STEP_UP_SESSION");
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE step_up_sessions SET consumed_at = $2
       WHERE session_id = $1 AND consumed_at IS NULL AND expires_at > $2`,
      [sessionId, now]
    );
    if (result.rowCount !== 1) throw new Error("STEP_UP_SESSION_UNAVAILABLE");
  } finally {
    client.release();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
