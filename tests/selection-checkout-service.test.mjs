import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createOrderAfterAdmission } from "../dist/application/SelectionCheckoutService.js";

const binding = JSON.parse(await readFile(new URL("../fixtures/paypal/gate0-binding.example.json", import.meta.url), "utf8"));
const now = "2026-10-18T12:00:00.000Z";
const evaluation = {
  outcome: { status: "ALLOW" },
  claimSet: { claimSetId: "claims-1" },
  claimSetHash: "sha256:claims",
  resolvedSelection: { subjectRef: "jacket-1", subjectHash: "sha256:subject", cartBinding: binding, cartSnapshotHash: "sha256:cart" },
  admissionEvidence: { evidenceManifestVersion: "none", evidenceSetHashes: [], attestationHashes: [], overrideHashes: [] }
};

test("persists ALLOW before PayPal, attaches after Binding A, and returns no order ID", async () => {
  const calls = [];
  const { pool } = fakePool(calls);
  const result = await createOrderAfterAdmission(evaluation, {
    pool,
    gateway: gateway(calls),
    newId: () => "admission-1",
    policyVersion: "policy-v1",
    now: () => new Date(now)
  });
  assert.deepEqual(calls, ["insert", "paypal-create", "paypal-get", "attach"]);
  assert.equal(result.admissionId, "admission-1");
  assert.equal(result.approvalUrl, "https://paypal.example/approve");
  assert.equal("orderId" in result, false);
});

test("aborts pending admission and returns no approval when Binding A fails", async () => {
  const calls = [];
  const { pool } = fakePool(calls);
  await assert.rejects(createOrderAfterAdmission(evaluation, {
    pool,
    gateway: gateway(calls, true),
    newId: () => "admission-1",
    policyVersion: "policy-v1",
    now: () => new Date(now)
  }), { message: "CART_BINDING_MISMATCH" });
  assert.deepEqual(calls, ["insert", "paypal-create", "paypal-get", "abort"]);
});

test("does not persist or call PayPal for STEP_UP or BLOCK", async () => {
  for (const outcome of [{ status: "STEP_UP", claimIds: ["claim-1"] }, { status: "BLOCK", reason: "failed" }]) {
    const calls = [];
    const { pool } = fakePool(calls);
    const result = await createOrderAfterAdmission({ ...evaluation, outcome }, {
      pool,
      gateway: gateway(calls),
      newId: () => "unused",
      policyVersion: "policy-v1",
      now: () => new Date(now)
    });
    assert.deepEqual(result, { outcome });
    assert.deepEqual(calls, []);
  }
});

function fakePool(calls) {
  return { pool: { async connect() { return {
    async query(sql) {
      if (sql.startsWith("INSERT INTO admissions")) calls.push("insert");
      else if (sql.startsWith("UPDATE admissions SET paypal_order_id")) { calls.push("attach"); return { rows: [{ admissionId: "admission-1" }] }; }
      else if (sql.startsWith("UPDATE admissions SET state = 'ABORTED'")) calls.push("abort");
      return { rows: [] };
    },
    release() {}
  }; } } };
}

function gateway(calls, drift = false) {
  const raw = paypalOrder();
  if (drift) raw.purchase_units[0].items[0].sku = "OTHER-SKU";
  return {
    async createOrder() { calls.push("paypal-create"); return { orderId: "order-1", orderStatus: "CREATED", approvalUrl: "https://paypal.example/approve", raw: {} }; },
    async getOrder() { calls.push("paypal-get"); return { orderId: "order-1", orderStatus: "CREATED", raw }; }
  };
}

function paypalOrder() {
  const money = (value) => ({ currency_code: binding.currency, value });
  return {
    intent: binding.intent,
    payment_source: { paypal: { experience_context: { shipping_preference: binding.shipping.preference } } },
    purchase_units: [{
      payee: { merchant_id: binding.payee.identityValue },
      amount: { currency_code: binding.currency, value: binding.amountBreakdown.total, breakdown: {
        item_total: money(binding.amountBreakdown.itemTotal), tax_total: money(binding.amountBreakdown.taxTotal),
        shipping: money(binding.amountBreakdown.shipping), handling: money(binding.amountBreakdown.handling),
        insurance: money(binding.amountBreakdown.insurance), shipping_discount: money(binding.amountBreakdown.shippingDiscount),
        discount: money(binding.amountBreakdown.discount)
      } },
      shipping: { name: { full_name: binding.shipping.name }, address: {
        address_line_1: binding.shipping.address.addressLine1, admin_area_2: binding.shipping.address.adminArea2,
        postal_code: binding.shipping.address.postalCode, country_code: binding.shipping.address.countryCode
      }, options: [{ id: binding.shipping.optionId, type: binding.shipping.type, amount: money(binding.shipping.amount), selected: true }] },
      items: binding.items.map((item) => ({ ...item, unit_amount: money(item.unitAmount), tax: money(item.tax) }))
    }],
    status: "CREATED"
  };
}
