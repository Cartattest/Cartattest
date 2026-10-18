import assert from "node:assert/strict";
import test from "node:test";
import { processPayPalWebhook } from "../dist/application/PayPalWebhookService.js";
import { recordVerifiedPayPalWebhook } from "../dist/persistence/PayPalWebhookRepository.js";

const attempt = {
  schemaVersion: "capture-attempt-v1", attemptId: "attempt-1", admissionId: "admission-1", paypalOrderId: "ORDER-1",
  materialHash: "sha256:material", paypalRequestId: "request-1", state: "CAPTURE_PENDING",
  paypalCaptureId: "CAPTURE-1", paypalCaptureStatus: "PENDING",
  createdAt: "2026-10-18T12:00:00.000Z", updatedAt: "2026-10-18T12:01:00.000Z"
};
const event = {
  id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: "CAPTURE-1", status: "COMPLETED", supplementary_data: { related_ids: { order_id: "ORDER-1" } }, payer: { email_address: "private@example.com" } }
};

test("verifies before storing and persists only the sanitized event projection", async () => {
  const calls = [];
  let verifiedPayload;
  const result = await processPayPalWebhook(JSON.stringify(event), {}, {
    webhookId: "webhook-1",
    verifier: { async verifyWebhookSignature(id, headers, payload) { verifiedPayload = payload; return id === "webhook-1"; } },
    pool: fakePool(calls, { attempt }),
    now: () => new Date("2026-10-18T12:02:00.000Z")
  });
  assert.equal(result, "APPLIED");
  assert.deepEqual(verifiedPayload, event);
  const insert = calls.find((call) => call.sql.startsWith("INSERT INTO paypal_webhook_events"));
  assert.deepEqual(insert.values[5], {
    id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", order_id: "ORDER-1", capture_id: "CAPTURE-1", capture_status: "COMPLETED"
  });
  assert.equal(JSON.stringify(insert.values[5]).includes("private@example.com"), false);
  assert.ok(calls.some((call) => call.sql.includes("UPDATE admissions SET state = 'CLOSED'")));
});

test("rejects invalid signatures before any persistence", async () => {
  let connects = 0;
  await assert.rejects(processPayPalWebhook(JSON.stringify(event), {}, {
    webhookId: "webhook-1", verifier: { async verifyWebhookSignature() { return false; } },
    pool: { async connect() { connects++; throw new Error("must not connect"); } }
  }), { message: "PAYPAL_WEBHOOK_SIGNATURE_INVALID" });
  assert.equal(connects, 0);
});

test("duplicate event IDs do not reapply state changes", async () => {
  const calls = [];
  const result = await recordVerifiedPayPalWebhook(fakePool(calls, { duplicate: true, attempt }), {
    eventId: "WH-1", eventType: event.event_type, orderId: "ORDER-1", captureId: "CAPTURE-1",
    captureStatus: "COMPLETED", verifiedAt: "2026-10-18T12:02:00.000Z"
  });
  assert.equal(result, "DUPLICATE");
  assert.equal(calls.some((call) => call.sql.startsWith("SELECT 'capture-attempt-v1'")), false);
});

test("closes a verified completion that arrives before the capture response is stored", async () => {
  const calls = [];
  const result = await recordVerifiedPayPalWebhook(fakePool(calls, { attempt: {
    ...attempt, state: "IN_FLIGHT", paypalCaptureId: undefined, paypalCaptureStatus: undefined
  } }), {
    eventId: "WH-2", eventType: event.event_type, orderId: "ORDER-1", captureId: "CAPTURE-1",
    captureStatus: "COMPLETED", verifiedAt: "2026-10-18T12:02:00.000Z"
  });
  assert.equal(result, "APPLIED");
  const update = calls.find((call) => call.sql.startsWith("UPDATE capture_attempts SET state"));
  assert.equal(update.values[1], "CLOSED_VERIFIED_WEBHOOK");
});

test("rejects a capture ID mismatch and rolls back the webhook insert", async () => {
  const calls = [];
  await assert.rejects(recordVerifiedPayPalWebhook(fakePool(calls, { attempt: { ...attempt, paypalCaptureId: "OTHER" } }), {
    eventId: "WH-1", eventType: event.event_type, orderId: "ORDER-1", captureId: "CAPTURE-1",
    captureStatus: "COMPLETED", verifiedAt: "2026-10-18T12:02:00.000Z"
  }), { message: "WEBHOOK_CAPTURE_ID_MISMATCH" });
  assert.equal(calls.at(-1).sql, "ROLLBACK");
});

test("rejects malformed and oversized bodies before signature checks", async () => {
  let verifyCalls = 0;
  const deps = { webhookId: "webhook-1", verifier: { async verifyWebhookSignature() { verifyCalls++; return true; } }, pool: fakePool([], {}) };
  await assert.rejects(processPayPalWebhook("{", {}, deps), { message: "INVALID_PAYPAL_WEBHOOK_BODY" });
  await assert.rejects(processPayPalWebhook(" ".repeat(1_000_001), {}, deps), { message: "PAYPAL_WEBHOOK_BODY_TOO_LARGE" });
  assert.equal(verifyCalls, 0);
});

function fakePool(calls, { attempt, duplicate = false }) {
  return { async connect() { return {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("INSERT INTO paypal_webhook_events")) return { rows: duplicate ? [] : [{ eventId: "WH-1" }] };
      if (sql.startsWith("SELECT 'capture-attempt-v1'")) return { rows: attempt ? [attempt] : [] };
      if (sql.startsWith("UPDATE capture_attempts SET state")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("UPDATE admissions SET state = 'CLOSED'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }, release() {}
  }; } };
}
