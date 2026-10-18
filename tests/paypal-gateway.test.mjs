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
  assert.equal(payload.purchase_units[0].payee.merchant_id, binding.payee.identityValue);
  assert.deepEqual(payload.purchase_units[0].amount.breakdown.handling, { currency_code: "GBP", value: "0.00" });
  assert.equal(payload.purchase_units[0].items[0].sku, "SHELL-BLUE-M");
  assert.equal(payload.purchase_units[0].shipping.address.country_code, "IE");
  assert.equal(payload.purchase_units[0].shipping.options[0].selected, true);
  assert.equal(payload.payment_source.paypal.experience_context.shipping_preference, "SET_PROVIDED_ADDRESS");
  assert.equal(payload.payment_source.paypal.experience_context.user_action, "PAY_NOW");
  assert.equal(payload.application_context, undefined);
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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
