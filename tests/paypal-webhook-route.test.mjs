import assert from "node:assert/strict";
import test from "node:test";
import { handlePayPalWebhookRequest } from "../dist/api/PayPalWebhookRoute.js";

const headers = {
  "content-type": "application/json",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  "paypal-transmission-id": "TRANSMISSION-1",
  "paypal-transmission-sig": "signature",
  "paypal-transmission-time": "2026-10-18T12:00:00Z"
};

test("accepts a verified webhook and returns an idempotent acknowledgement", async () => {
  let verifiedEvent;
  const response = await handlePayPalWebhookRequest(new Request("https://service.example/api/webhooks/paypal", {
    method: "POST", headers, body: JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" })
  }), {
    webhookId: "webhook-1", verifier: { async verifyWebhookSignature(id, sentHeaders, event) {
      assert.equal(id, "webhook-1"); assert.equal(sentHeaders["paypal-transmission-id"], "TRANSMISSION-1");
      verifiedEvent = event; return true;
    } },
    pool: { async connect() { return { async query(sql) {
      if (sql.startsWith("INSERT INTO paypal_webhook_events")) return { rows: [{ eventId: "WH-1" }] };
      return { rows: [] };
    }, release() {} }; } }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, result: "RECORDED" });
  assert.deepEqual(verifiedEvent, { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" });
});

test("rejects wrong method, content type, invalid signature and oversized streamed bodies", async () => {
  const dependencies = { webhookId: "id", verifier: { async verifyWebhookSignature() { return false; } },
    pool: { async connect() { assert.fail("invalid requests do not persist"); } } };
  assert.equal((await handlePayPalWebhookRequest(new Request("https://service.example/api/webhooks/paypal"), dependencies)).status, 405);
  assert.equal((await handlePayPalWebhookRequest(new Request("https://service.example/api/webhooks/paypal", {
    method: "POST", headers: { "content-type": "text/plain" }, body: "{}"
  }), dependencies)).status, 415);
  assert.equal((await handlePayPalWebhookRequest(new Request("https://service.example/api/webhooks/paypal", {
    method: "POST", headers, body: "{}"
  }), dependencies)).status, 400);
  const largeBody = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(600_000)); controller.enqueue(new Uint8Array(500_001)); controller.close();
  } });
  assert.equal((await handlePayPalWebhookRequest(new Request("https://service.example/api/webhooks/paypal", {
    method: "POST", headers: { ...headers, "content-length": "1100001" }, body: largeBody, duplex: "half"
  }), dependencies)).status, 413);
});

test("returns a retryable gateway response when verification or persistence is unavailable", async () => {
  const response = await handlePayPalWebhookRequest(new Request("https://service.example/api/webhooks/paypal", {
    method: "POST", headers, body: JSON.stringify({ id: "WH-1", event_type: "TYPE" })
  }), {
    webhookId: "id", verifier: { async verifyWebhookSignature() { throw new Error("PAYPAL_API_FAILED 503"); } },
    pool: { async connect() { assert.fail("verification failed before persistence"); } }
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "PAYPAL_WEBHOOK_FAILED" });
});
