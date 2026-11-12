import type { SqlPool } from "./CaptureAttemptRepository.js";

export type DecisionOutcome = "ALLOW" | "STEP_UP" | "BLOCK" | "CHOOSE_ANOTHER";

export interface DecisionLogEntry {
  decisionId: string;
  createdAt: string;
  source: "SELECTION" | "STEP_UP_DECISION";
  claimSetId?: string;
  subjectRef?: string;
  outcome: DecisionOutcome;
  reason?: string;
  admissionId?: string;
  stepUpSessionId?: string;
  summary: Record<string, unknown>;
}

export interface DecisionLogRow extends DecisionLogEntry {
  paypalOrderId?: string;
  admissionState?: string;
  captureState?: string;
  captureStatus?: string;
  receiptAvailable: boolean;
}

const outcomes = new Set(["ALLOW", "STEP_UP", "BLOCK", "CHOOSE_ANOTHER"]);

export async function recordDecision(pool: SqlPool, entry: DecisionLogEntry): Promise<void> {
  if (!entry.decisionId || !Number.isFinite(Date.parse(entry.createdAt)) || !outcomes.has(entry.outcome) ||
      typeof entry.summary !== "object" || entry.summary === null) throw new Error("INVALID_DECISION_LOG_ENTRY");
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO decision_log (decision_id, created_at, source, claim_set_id, subject_ref, outcome, reason,
         admission_id, step_up_session_id, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [entry.decisionId, entry.createdAt, entry.source, entry.claimSetId ?? null, entry.subjectRef ?? null, entry.outcome,
        entry.reason ?? null, entry.admissionId ?? null, entry.stepUpSessionId ?? null, JSON.stringify(entry.summary)]
    );
  } finally {
    client.release();
  }
}

export async function listDecisions(pool: SqlPool, limit = 500): Promise<DecisionLogRow[]> {
  const bounded = Math.max(1, Math.min(2000, Math.floor(limit)));
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT d.decision_id, d.created_at, d.source, d.claim_set_id, d.subject_ref, d.outcome, d.reason,
              d.admission_id, d.step_up_session_id, d.summary,
              a.paypal_order_id, a.state AS admission_state,
              c.state AS capture_state, c.paypal_capture_status,
              (b.bundle_id IS NOT NULL) AS receipt_available
       FROM decision_log d
       LEFT JOIN admissions a ON a.admission_id = d.admission_id
       LEFT JOIN LATERAL (
         SELECT state, paypal_capture_status FROM capture_attempts
         WHERE admission_id = d.admission_id ORDER BY updated_at DESC LIMIT 1
       ) c ON TRUE
       LEFT JOIN evidence_bundles b ON b.bundle_id = d.admission_id
       ORDER BY d.created_at DESC
       LIMIT $1`,
      [bounded]
    );
    return result.rows.map((row) => ({
      decisionId: String(row.decision_id),
      createdAt: new Date(row.created_at as string).toISOString(),
      source: row.source as DecisionLogEntry["source"],
      ...(row.claim_set_id ? { claimSetId: String(row.claim_set_id) } : {}),
      ...(row.subject_ref ? { subjectRef: String(row.subject_ref) } : {}),
      outcome: row.outcome as DecisionOutcome,
      ...(row.reason ? { reason: String(row.reason) } : {}),
      ...(row.admission_id ? { admissionId: String(row.admission_id) } : {}),
      ...(row.step_up_session_id ? { stepUpSessionId: String(row.step_up_session_id) } : {}),
      summary: (typeof row.summary === "object" && row.summary !== null ? row.summary : {}) as Record<string, unknown>,
      ...(row.paypal_order_id ? { paypalOrderId: String(row.paypal_order_id) } : {}),
      ...(row.admission_state ? { admissionState: String(row.admission_state) } : {}),
      ...(row.capture_state ? { captureState: String(row.capture_state) } : {}),
      ...(row.paypal_capture_status ? { captureStatus: String(row.paypal_capture_status) } : {}),
      receiptAvailable: row.receipt_available === true
    }));
  } finally {
    client.release();
  }
}
