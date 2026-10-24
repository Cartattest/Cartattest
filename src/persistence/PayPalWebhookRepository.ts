import { nextCaptureState, type CaptureEvent } from "../execution/CaptureStateMachine.js";
import type { CaptureAttemptV1 } from "../domain/types.js";
import { parseCaptureAttemptV1 } from "../api/CheckoutRecordValidation.js";
import type { SqlPool } from "./CaptureAttemptRepository.js";

export interface VerifiedPayPalWebhookEvent {
  eventId: string;
  eventType: string;
  orderId?: string;
  captureId?: string;
  captureStatus?: string;
  verifiedAt: string;
}

export async function recordVerifiedPayPalWebhook(
  pool: SqlPool,
  event: VerifiedPayPalWebhookEvent
): Promise<"APPLIED" | "RECORDED" | "DUPLICATE"> {
  if (!event.eventId.trim() || !event.eventType.trim() || !Number.isFinite(Date.parse(event.verifiedAt))) {
    throw new Error("INVALID_PAYPAL_WEBHOOK_EVENT");
  }
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const payload = {
      id: event.eventId,
      event_type: event.eventType,
      ...(event.orderId ? { order_id: event.orderId } : {}),
      ...(event.captureId ? { capture_id: event.captureId } : {}),
      ...(event.captureStatus ? { capture_status: event.captureStatus } : {})
    };
    const inserted = await client.query(
      `INSERT INTO paypal_webhook_events (event_id, event_type, paypal_order_id, paypal_capture_id, verified_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.eventId, event.eventType, event.orderId ?? null, event.captureId ?? null, event.verifiedAt, payload]
    );
    if (!inserted.rows[0]) {
      const existing = await client.query(
        `SELECT event_type AS "eventType", paypal_order_id AS "orderId", paypal_capture_id AS "captureId",
                payload->>'capture_status' AS "captureStatus"
         FROM paypal_webhook_events WHERE event_id = $1`,
        [event.eventId]
      );
      const stored = existing.rows[0];
      if (!stored || stored.eventType !== event.eventType || stored.orderId !== (event.orderId ?? null) ||
          stored.captureId !== (event.captureId ?? null) || stored.captureStatus !== (event.captureStatus ?? null)) {
        throw new Error("WEBHOOK_EVENT_ID_CONFLICT");
      }
      await client.query("COMMIT");
      inTransaction = false;
      return "DUPLICATE";
    }

    const eventType: Partial<Record<string, CaptureEvent>> = {
      "PAYMENT.CAPTURE.COMPLETED": "WEBHOOK_VERIFIED",
      "PAYMENT.CAPTURE.PENDING": "PAYPAL_PENDING",
      "PAYMENT.CAPTURE.DENIED": "PAYPAL_DECLINED"
    };
    const transition = eventType[event.eventType];
    if (!transition || !event.orderId || !event.captureId) {
      await client.query("COMMIT");
      inTransaction = false;
      return "RECORDED";
    }

    const selected = await client.query(
      `SELECT 'capture-attempt-v1' AS "schemaVersion", attempt_id AS "attemptId", admission_id AS "admissionId",
              paypal_order_id AS "paypalOrderId", material_hash AS "materialHash", paypal_request_id AS "paypalRequestId",
              state, paypal_capture_id AS "paypalCaptureId", paypal_capture_status AS "paypalCaptureStatus",
              created_at::text AS "createdAt", updated_at::text AS "updatedAt"
       FROM capture_attempts WHERE paypal_order_id = $1 AND state IN
         ('IN_FLIGHT', 'EXECUTION_UNKNOWN', 'CAPTURE_PENDING', 'CAPTURE_COMPLETED_PENDING_WEBHOOK')
       FOR UPDATE`,
      [event.orderId]
    );
    const row = selected.rows[0];
    if (!row) {
      await client.query("COMMIT");
      inTransaction = false;
      return "RECORDED";
    }
    const current = parseCaptureAttemptV1(row);
    if (current.paypalCaptureId && current.paypalCaptureId !== event.captureId) throw new Error("WEBHOOK_CAPTURE_ID_MISMATCH");
    if (event.eventType === "PAYMENT.CAPTURE.PENDING" && current.state === "CAPTURE_PENDING") {
      await client.query("COMMIT");
      inTransaction = false;
      return "RECORDED";
    }
    let state = event.eventType === "PAYMENT.CAPTURE.COMPLETED" &&
      (current.state === "IN_FLIGHT" || current.state === "EXECUTION_UNKNOWN")
      ? nextCaptureState(current.state, "PAYPAL_COMPLETED")
      : nextCaptureState(current.state, transition);
    if (event.eventType === "PAYMENT.CAPTURE.COMPLETED" && state === "CAPTURE_COMPLETED_PENDING_WEBHOOK") {
      state = nextCaptureState(state, "WEBHOOK_VERIFIED");
    }
    const paypalCaptureStatus = event.eventType === "PAYMENT.CAPTURE.COMPLETED" ? "COMPLETED"
      : event.eventType === "PAYMENT.CAPTURE.PENDING" ? "PENDING" : "DECLINED";
    const updatedAt = new Date(Math.max(Date.parse(event.verifiedAt), Date.parse(current.updatedAt))).toISOString();
    const updated = await client.query(
      `UPDATE capture_attempts SET state = $2, paypal_capture_id = $3, paypal_capture_status = $4, updated_at = $5
       WHERE attempt_id = $1`,
      [current.attemptId, state, event.captureId, paypalCaptureStatus, updatedAt]
    );
    if (updated.rowCount !== 1) throw new Error("CAPTURE_ATTEMPT_NOT_FOUND");

    if (state === "CLOSED_VERIFIED_WEBHOOK") {
      const closed = await client.query(
        `UPDATE admissions SET state = 'CLOSED' WHERE admission_id = $1 AND state = 'CAPTURE_STARTED'`,
        [current.admissionId]
      );
      if (closed.rowCount !== 1) throw new Error("ADMISSION_CLOSE_FAILED");
    }
    await client.query("COMMIT");
    inTransaction = false;
    return "APPLIED";
  } catch (error) {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch { /* Keep the original transaction failure. */ }
    }
    throw error;
  } finally {
    client.release();
  }
}
