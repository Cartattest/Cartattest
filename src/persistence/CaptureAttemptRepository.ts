import type { CaptureAttemptV1 } from "../domain/types.js";
import { parseCaptureAttemptV1 } from "../api/CheckoutRecordValidation.js";

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

interface SqlConnection {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
}

export interface SqlPool {
  connect(): Promise<SqlConnection>;
}

const activeStates = "'IN_FLIGHT', 'EXECUTION_UNKNOWN', 'CAPTURE_PENDING', 'CAPTURE_COMPLETED_PENDING_WEBHOOK'";

export async function startCaptureAttempt(
  pool: SqlPool,
  attempt: CaptureAttemptV1,
  now: string
): Promise<CaptureAttemptV1> {
  const validated = parseCaptureAttemptV1(attempt);
  if (validated.state !== "IN_FLIGHT" || !Number.isFinite(Date.parse(now))) throw new Error("INVALID_CAPTURE_ATTEMPT");

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const existing = await client.query(
      `SELECT 'capture-attempt-v1' AS "schemaVersion", ca.attempt_id AS "attemptId",
              ca.admission_id AS "admissionId", ca.paypal_order_id AS "paypalOrderId",
              ca.material_hash AS "materialHash", ca.paypal_request_id AS "paypalRequestId", ca.state,
              ca.paypal_capture_id AS "paypalCaptureId", ca.paypal_capture_status AS "paypalCaptureStatus",
              ca.created_at::text AS "createdAt", ca.updated_at::text AS "updatedAt"
       FROM capture_attempts ca JOIN admissions a ON a.admission_id = ca.admission_id
       WHERE ca.admission_id = $1 AND ca.paypal_order_id = $2 AND ca.state IN (${activeStates})
       FOR UPDATE OF a, ca`,
      [validated.admissionId, validated.paypalOrderId]
    );
    if (existing.rows[0]) {
      const active = parseCaptureAttemptV1(existing.rows[0]);
      if (active.materialHash !== validated.materialHash) throw new Error("CAPTURE_ATTEMPT_MISMATCH");
      await client.query("COMMIT");
      inTransaction = false;
      return active;
    }

    const admission = await client.query(
      `SELECT admission_id FROM admissions
       WHERE admission_id = $1 AND paypal_order_id = $2 AND state = 'AWAITING_APPROVAL' AND expires_at > $3
       FOR UPDATE`,
      [validated.admissionId, validated.paypalOrderId, now]
    );
    if (!admission.rows[0]) throw new Error("ADMISSION_NOT_CAPTUREABLE");

    await client.query(
      `INSERT INTO capture_attempts
         (attempt_id, admission_id, paypal_order_id, material_hash, paypal_request_id, state,
          paypal_capture_id, paypal_capture_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [validated.attemptId, validated.admissionId, validated.paypalOrderId, validated.materialHash,
        validated.paypalRequestId, validated.state, validated.paypalCaptureId ?? null,
        validated.paypalCaptureStatus ?? null, validated.createdAt, validated.updatedAt]
    );
    const updated = await client.query(
      `UPDATE admissions SET state = 'CAPTURE_STARTED'
       WHERE admission_id = $1 AND state = 'AWAITING_APPROVAL'`,
      [validated.admissionId]
    );
    if (updated.rowCount !== 1) throw new Error("ADMISSION_NOT_CAPTUREABLE");
    await client.query("COMMIT");
    inTransaction = false;
    return validated;
  } catch (error) {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch { /* Keep the original transaction failure. */ }
    }
    throw error;
  } finally {
    client.release();
  }
}
