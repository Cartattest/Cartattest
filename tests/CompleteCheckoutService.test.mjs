import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hashCartBinding } from "../dist/binding/CartBindingV1.js";
import { completeCheckout } from "../dist/application/CompleteCheckoutService.js";

const binding = JSON.parse(await readFile(new URL("../fixtures/paypal/gate0-binding.example.json", import.meta.url), "utf8"));
const bindingHash = await hashCartBinding(binding);
const now = "2026-10-18T12:02:00.000Z";
const admission = {
  schemaVersion: "admission-record-v1", admissionId: "admission-1", claimSetHash: "sha256:claims",
  subjectHash: "sha256:subject", resolvedCartSnapshotHash: "sha256:cart", evidenceManifestVersion: "none",
  evidenceSetHashes: [], attestationHashes: [], overrideHashes: [], policyVersion: "policy-v1", cartBindingProfile: "v1",
  admittedCartBindingHash: bindingHash, paypalOrderId: "ORDER-1", outcome: "ALLOW",
  createdAt: "2026-10-18T12:00:00.000Z", expiresAt: "2026-10-18T12:15:00.000Z"
};
const admissionRow = { ...admission, subjectRef: "jacket-1", admittedCartBinding: binding };

test("checks Binding B, claims a capture attempt, then persists PayPal completion", async () => {
  const calls = [];
  const pool = fakePool(calls, { admissionRow });
  const result = await completeCheckout({ admissionId: "admission-1" }, {
    pool, gateway: gateway(calls), newId: (() => { let id = 0; return () => `id-${++id}`; })(),
    now: () => new Date(now)
  });
  assert.equal(result.state, "CAPTURE_COMPLETED_PENDING_WEBHOOK");
  assert.equal(result.paypalCaptureId, "CAPTURE-1");
  assert.deepEqual(calls.filter((call) => typeof call === "string"), ["paypal-get", "paypal-capture"]);
  assert.ok(calls.indexOf("paypal-get") < calls.findIndex((call) => typeof call === "object" && call.sql?.startsWith("INSERT INTO capture_attempts")));
});

test("does not claim or capture when the approved order binding changed", async () => {
  const calls = [];
  const drift = gateway(calls, { drift: true });
  await assert.rejects(completeCheckout({ admissionId: "admission-1" }, {
    pool: fakePool(calls, { admissionRow }), gateway: drift, newId: () => "unused", now: () => new Date(now)
  }), { message: "CART_BINDING_MISMATCH" });
  assert.deepEqual(calls.filter((call) => typeof call === "string"), ["paypal-get"]);
});

test("records an ambiguous result after the capture request fails", async () => {
  const calls = [];
  await assert.rejects(completeCheckout({ admissionId: "admission-1" }, {
    pool: fakePool(calls, { admissionRow }), gateway: gateway(calls, { failCapture: true }),
    newId: (() => { let id = 0; return () => `id-${++id}`; })(), now: () => new Date(now)
  }), { message: "network timeout" });
  assert.ok(calls.some((call) => typeof call === "object" && call.values?.[1] === "EXECUTION_UNKNOWN"));
});

function fakePool(calls, { admissionRow }) {
  let attempt;
  return { async connect() { return {
    async query(sql, values = []) {
      const call = { sql, values }; calls.push(call);
      if (sql.includes("FROM admissions a JOIN claim_sets cs")) return { rows: [admissionRow] };
      if (sql.startsWith("SELECT 'capture-attempt-v1'")) return { rows: attempt ? [attempt] : [] };
      if (sql.startsWith("SELECT admission_id FROM admissions")) return { rows: [{ admissionId: "admission-1" }] };
      if (sql.startsWith("INSERT INTO capture_attempts")) { attempt = {
        schemaVersion: "capture-attempt-v1", attemptId: values[0], admissionId: values[1], paypalOrderId: values[2],
        materialHash: values[3], paypalRequestId: values[4], state: values[5], createdAt: values[8], updatedAt: values[9]
      }; return { rows: [] }; }
      if (sql.startsWith("UPDATE capture_attempts SET state")) {
        attempt = { ...attempt, state: values[1], ...(values[2] ? { paypalCaptureId: values[2] } : {}),
          ...(values[3] ? { paypalCaptureStatus: values[3] } : {}), updatedAt: values[4] };
        return { rows: [attempt] };
      }
      return { rows: [], rowCount: 1 };
    }, release() {}
  }; } };
}

function gateway(calls, { drift = false, failCapture = false } = {}) {
  const raw = paypalOrder();
  if (drift) raw.purchase_units[0].items[0].sku = "OTHER";
  return {
    async getOrder() { calls.push("paypal-get"); return { orderId: "ORDER-1", orderStatus: "APPROVED", raw }; },
    async captureOrder() { calls.push("paypal-capture"); if (failCapture) throw new Error("network timeout");
      return { httpStatus: 201, orderId: "ORDER-1", captureId: "CAPTURE-1", captureStatus: "COMPLETED", raw: {} }; }
  };
}

function paypalOrder() {
  const money = (value) => ({ currency_code: binding.currency, value });
  return { intent: binding.intent,
    payment_source: { paypal: { experience_context: { shipping_preference: binding.shipping.preference } } },
    purchase_units: [{ payee: { merchant_id: binding.payee.identityValue },
      amount: { currency_code: binding.currency, value: binding.amountBreakdown.total, breakdown: {
        item_total: money(binding.amountBreakdown.itemTotal), tax_total: money(binding.amountBreakdown.taxTotal),
        shipping: money(binding.amountBreakdown.shipping), handling: money(binding.amountBreakdown.handling),
        insurance: money(binding.amountBreakdown.insurance), shipping_discount: money(binding.amountBreakdown.shippingDiscount),
        discount: money(binding.amountBreakdown.discount) } },
      shipping: { name: { full_name: binding.shipping.name }, address: { address_line_1: binding.shipping.address.addressLine1,
        admin_area_2: binding.shipping.address.adminArea2, postal_code: binding.shipping.address.postalCode,
        country_code: binding.shipping.address.countryCode }, options: [{ id: binding.shipping.optionId, type: binding.shipping.type,
        amount: money(binding.shipping.amount), selected: true }] },
      items: binding.items.map((item) => ({ name: item.name, sku: item.sku, quantity: item.quantity,
        unit_amount: money(item.unitAmount), tax: money(item.tax) })) }], status: "APPROVED" };
}
