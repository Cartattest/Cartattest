import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OrdersV2Gateway } from "../dist/paypal/OrdersV2Gateway.js";

const binding = JSON.parse(await readFile(new URL("../fixtures/paypal/gate0-binding.example.json", import.meta.url), "utf8"));

test("creates one sandbox order with the admitted payee, breakdown, item and fixed shipping", async () => {
  const calls = [];
  const gateway = new OrdersV2Gateway({
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    environment: "sandbox",
    returnUrl: "https://merchant.example/checkout/return",
    cancelUrl: "https://merchant.example/checkout/cancel",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/oauth2/token")) {
        return json({ access_token: "sandbox-token", expires_in: 3600 });
      }
      return json({
        id: "SANDBOX-ORDER-1",
        status: "CREATED",
        links: [{ rel: "approve", href: "https://sandbox.example/approve" }]
      }, 201);
    }
  });

  const result = await gateway.createOrder(binding);
  const tokenCall = calls[0];
  const createCall = calls[1];
  const payload = JSON.parse(createCall.init.body);

  assert.equal(result.orderId, "SANDBOX-ORDER-1");
  assert.equal(result.approvalUrl, "https://sandbox.example/approve");
  assert.equal(calls.length, 2);
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${btoa("sandbox-client:sandbox-secret")}`);
  assert.equal(createCall.init.headers.Authorization, "Bearer sandbox-token");
  assert.match(createCall.init.headers["PayPal-Request-Id"], /^[0-9a-f-]{36}$/i);
  assert.equal(payload.intent, "CAPTURE");
  assert.equal(payload.purchase_units.length, 1);
  assert.equal(payload.purchase_units[0].payee.email_address, binding.payee.identityValue);
  assert.deepEqual(payload.purchase_units[0].amount.breakdown.handling, { currency_code: "GBP", value: "0.00" });
  assert.equal(payload.purchase_units[0].items[0].sku, "SHELL-BLUE-M");
  assert.equal(payload.purchase_units[0].shipping.address.country_code, "IE");
  assert.equal(payload.purchase_units[0].shipping.options, undefined);
  assert.equal(payload.payment_source.paypal.experience_context.shipping_preference, "SET_PROVIDED_ADDRESS");
  assert.equal(payload.payment_source.paypal.experience_context.user_action, "PAY_NOW");
  assert.equal(payload.payment_source.paypal.experience_context.return_url, "https://merchant.example/checkout/return");
  assert.equal(payload.payment_source.paypal.experience_context.cancel_url, "https://merchant.example/checkout/cancel");
  assert.equal(payload.application_context, undefined);
});

test("requires both PayPal browser return URLs when either is configured", () => {
  assert.throws(() => new OrdersV2Gateway({
    clientId: "sandbox-client", clientSecret: "sandbox-secret", environment: "sandbox",
    returnUrl: "https://merchant.example/checkout/return"
  }), { message: "PAYPAL_RETURN_URLS_REQUIRED" });
});

test("returns PayPal's payer-action link for orders that require buyer approval", async () => {
  const gateway = new OrdersV2Gateway({
    clientId: "sandbox-client", clientSecret: "sandbox-secret", environment: "sandbox",
    fetch: async (url) => String(url).endsWith("/v1/oauth2/token")
      ? json({ access_token: "sandbox-token", expires_in: 3600 })
      : json({ id: "SANDBOX-ORDER-2", status: "PAYER_ACTION_REQUIRED", links: [
        { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkout?token=SANDBOX-ORDER-2" }
      ] })
  });

  const result = await gateway.getOrder("SANDBOX-ORDER-2");

  assert.equal(result.approvalUrl, "https://www.sandbox.paypal.com/checkout?token=SANDBOX-ORDER-2");
});

test("captures with the persisted request ID and returns PayPal HTTP and capture statuses", async () => {
  const calls = [];
  const gateway = new OrdersV2Gateway({
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    environment: "sandbox",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/oauth2/token")) return json({ access_token: "sandbox-token", expires_in: 3600 });
      return json({
        id: "SANDBOX-ORDER-1",
        status: "COMPLETED",
        purchase_units: [{ payments: { captures: [{ id: "CAPTURE-1", status: "COMPLETED" }] } }]
      }, 201);
    }
  });

  const result = await gateway.captureOrder("SANDBOX-ORDER-1", "persisted-capture-attempt-1");

  assert.equal(result.httpStatus, 201);
  assert.equal(result.captureId, "CAPTURE-1");
  assert.equal(result.captureStatus, "COMPLETED");
  assert.equal(calls[1].init.headers["PayPal-Request-Id"], "persisted-capture-attempt-1");
  assert.equal(calls[1].url, "https://api-m.sandbox.paypal.com/v2/checkout/orders/SANDBOX-ORDER-1/capture");
});

test("verifies a webhook with PayPal before returning the provider verdict", async () => {
  const calls = [];
  const event = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" };
  const gateway = new OrdersV2Gateway({
    clientId: "sandbox-client", clientSecret: "sandbox-secret", environment: "sandbox",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return String(url).endsWith("/v1/oauth2/token")
        ? json({ access_token: "sandbox-token", expires_in: 3600 })
        : json({ verification_status: "SUCCESS" });
    }
  });
  const headers = webhookHeaders();
  assert.equal(await gateway.verifyWebhookSignature("SANDBOX-WEBHOOK", headers, event), true);
  assert.equal(calls[1].url, "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    auth_algo: headers["paypal-auth-algo"], cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"], transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"], webhook_id: "SANDBOX-WEBHOOK", webhook_event: event
  });
});

test("rejects incomplete or non-PayPal certificate URLs before verification requests", async () => {
  let requests = 0;
  const gateway = new OrdersV2Gateway({ clientId: "client", clientSecret: "secret", environment: "sandbox",
    fetch: async () => { requests++; return json({ access_token: "token", expires_in: 3600 }); } });
  await assert.rejects(gateway.verifyWebhookSignature("id", { ...webhookHeaders(), "paypal-cert-url": "https://attacker.example/cert" }, {}),
    { message: "PAYPAL_WEBHOOK_HEADERS_INVALID" });
  assert.equal(requests, 0);
  await assert.rejects(gateway.verifyWebhookSignature("id", { "paypal-transmission-id": "only-one" }, {}),
    { message: "PAYPAL_WEBHOOK_HEADERS_INVALID" });
  assert.equal(requests, 0);
});

test("returns false when PayPal rejects webhook authenticity", async () => {
  const gateway = new OrdersV2Gateway({ clientId: "client", clientSecret: "secret", environment: "sandbox",
    fetch: async (url) => String(url).endsWith("/v1/oauth2/token")
      ? json({ access_token: "token", expires_in: 3600 }) : json({ verification_status: "FAILURE" }) });
  assert.equal(await gateway.verifyWebhookSignature("id", webhookHeaders(), { id: "WH-1" }), false);
});

test("rejects malformed OAuth token responses before making an API request", async () => {
  let calls = 0;
  const gateway = new OrdersV2Gateway({
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    environment: "sandbox",
    fetch: async () => {
      calls++;
      return json({ access_token: {}, expires_in: "3600" });
    }
  });

  await assert.rejects(gateway.getOrder("SANDBOX-ORDER-1"), /PAYPAL_OAUTH_FAILED 200/);
  assert.equal(calls, 1);
});

test("reuses a cached OAuth token for subsequent API calls", async () => {
  let tokenCalls = 0;
  let orderCalls = 0;
  const gateway = new OrdersV2Gateway({
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    environment: "sandbox",
    fetch: async (url) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        tokenCalls++;
        return json({ access_token: "sandbox-token", expires_in: 3600 });
      }
      orderCalls++;
      return json({ id: "SANDBOX-ORDER-1", status: "CREATED" });
    }
  });

  await gateway.getOrder("SANDBOX-ORDER-1");
  await gateway.getOrder("SANDBOX-ORDER-1");

  assert.equal(tokenCalls, 1);
  assert.equal(orderCalls, 2);
});

test("reports PayPal API failures without including unrelated response fields", async () => {
  const gateway = new OrdersV2Gateway({
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    environment: "sandbox",
    fetch: async (url) => String(url).endsWith("/v1/oauth2/token")
      ? json({ access_token: "sandbox-token", expires_in: 3600 })
      : json({ name: "RESOURCE_NOT_FOUND", debug_id: "private-debug-id", details: [{ issue: "ORDER_MISSING", field: "/id" }] }, 404)
  });

  await assert.rejects(gateway.getOrder("SANDBOX-ORDER-1"), (error) => {
    assert.match(error.message, /PAYPAL_API_FAILED 404 RESOURCE_NOT_FOUND details=ORDER_MISSING@\/id/);
    assert.doesNotMatch(error.message, /private-debug-id/);
    return true;
  });
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function webhookHeaders() {
  return {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "TRANSMISSION-1",
    "paypal-transmission-sig": "signature",
    "paypal-transmission-time": "2026-10-18T12:00:00Z"
  };
}
