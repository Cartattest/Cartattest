import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkApprovedOrderBinding, createOrderWithBindingA } from "../dist/execution/BindingChecks.js";

const binding = JSON.parse(await readFile(new URL("../fixtures/paypal/gate0-binding.example.json", import.meta.url), "utf8"));
const paypalOrder = (status = "CREATED", overrides = {}) => ({
  intent: binding.intent,
  payment_source: { paypal: { experience_context: { shipping_preference: binding.shipping.preference } } },
  purchase_units: [{
    payee: binding.payee.identityType === "MERCHANT_ID"
      ? { merchant_id: binding.payee.identityValue }
      : { email_address: binding.payee.identityValue },
    amount: {
      currency_code: binding.currency,
      value: binding.amountBreakdown.total,
      breakdown: {
        item_total: money(binding.amountBreakdown.itemTotal),
        tax_total: money(binding.amountBreakdown.taxTotal),
        shipping: money(binding.amountBreakdown.shipping),
        handling: money(binding.amountBreakdown.handling),
        insurance: money(binding.amountBreakdown.insurance),
        shipping_discount: money(binding.amountBreakdown.shippingDiscount),
        discount: money(binding.amountBreakdown.discount)
      }
    },
    shipping: {
      name: { full_name: binding.shipping.name },
      address: {
        address_line_1: binding.shipping.address.addressLine1,
        ...(binding.shipping.address.addressLine2 ? { address_line_2: binding.shipping.address.addressLine2 } : {}),
        admin_area_2: binding.shipping.address.adminArea2,
        ...(binding.shipping.address.adminArea1 ? { admin_area_1: binding.shipping.address.adminArea1 } : {}),
        postal_code: binding.shipping.address.postalCode,
        country_code: binding.shipping.address.countryCode
      },
      options: [{
        id: binding.shipping.optionId,
        type: binding.shipping.type,
        amount: money(binding.shipping.amount),
        selected: true
      }]
    },
    items: binding.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unit_amount: money(item.unitAmount),
      tax: money(item.tax)
    }))
  }],
  status,
  ...overrides
});

test("creates an order and exposes approval only after Binding A passes", async () => {
  const calls = [];
  const gateway = {
    createOrder: async () => {
      calls.push("create");
      return { orderId: "ORDER-1", orderStatus: "CREATED", approvalUrl: "https://paypal.example/approve", raw: {} };
    },
    getOrder: async () => {
      calls.push("get");
      return { orderId: "ORDER-1", orderStatus: "CREATED", raw: paypalOrder("CREATED") };
    }
  };

  assert.deepEqual(await createOrderWithBindingA(gateway, binding), {
    orderId: "ORDER-1",
    approvalUrl: "https://paypal.example/approve"
  });
  assert.deepEqual(calls, ["create", "get"]);
});

test("accepts PayPal's PAYER_ACTION_REQUIRED status during Binding A", async () => {
  const gateway = {
    createOrder: async () => ({ orderId: "ORDER-1", orderStatus: "PAYER_ACTION_REQUIRED", approvalUrl: "https://paypal.example/approve", raw: {} }),
    getOrder: async () => ({ orderId: "ORDER-1", orderStatus: "PAYER_ACTION_REQUIRED", raw: paypalOrder("PAYER_ACTION_REQUIRED") })
  };

  assert.deepEqual(await createOrderWithBindingA(gateway, binding), {
    orderId: "ORDER-1",
    approvalUrl: "https://paypal.example/approve"
  });
});

test("uses the admitted shipping preference when PayPal omits it from the order response", async () => {
  const orderWithoutPreference = paypalOrder("PAYER_ACTION_REQUIRED");
  delete orderWithoutPreference.payment_source;
  const gateway = {
    createOrder: async () => ({ orderId: "ORDER-1", orderStatus: "PAYER_ACTION_REQUIRED", approvalUrl: "https://paypal.example/approve", raw: {} }),
    getOrder: async () => ({ orderId: "ORDER-1", orderStatus: "PAYER_ACTION_REQUIRED", raw: orderWithoutPreference })
  };

  assert.deepEqual(await createOrderWithBindingA(gateway, binding), {
    orderId: "ORDER-1",
    approvalUrl: "https://paypal.example/approve"
  });
});

test("does not expose approval when Binding A detects order drift", async () => {
  const gateway = {
    createOrder: async () => ({ orderId: "ORDER-1", orderStatus: "CREATED", approvalUrl: "https://paypal.example/approve", raw: {} }),
    getOrder: async () => ({
      orderId: "ORDER-1",
      orderStatus: "CREATED",
      raw: paypalOrder("CREATED", { purchase_units: [{ ...paypalOrder().purchase_units[0], items: [{ ...paypalOrder().purchase_units[0].items[0], sku: "OTHER-SKU" }] }] })
    })
  };

  await assert.rejects(createOrderWithBindingA(gateway, binding), { message: "CART_BINDING_MISMATCH" });
});

test("Binding A rejects unexpected order status or a missing approval URL", async () => {
  await assert.rejects(createOrderWithBindingA({
    createOrder: async () => ({ orderId: "ORDER-1", orderStatus: "APPROVED", approvalUrl: "https://paypal.example/approve", raw: {} }),
    getOrder: async () => { assert.fail("must not GET a non-created order"); }
  }, binding), { message: "PAYPAL_ORDER_NOT_CREATED" });
  await assert.rejects(createOrderWithBindingA({
    createOrder: async () => ({ orderId: "ORDER-1", orderStatus: "CREATED", raw: {} }),
    getOrder: async () => ({ orderId: "ORDER-1", orderStatus: "CREATED", raw: paypalOrder("CREATED") })
  }, binding), { message: "PAYPAL_APPROVAL_LINK_MISSING" });
});

test("Binding B checks expiry before reading PayPal and requires approval", async () => {
  let calls = 0;
  const gateway = {
    getOrder: async () => {
      calls++;
      return { orderId: "ORDER-1", orderStatus: "APPROVED", raw: paypalOrder("APPROVED") };
    }
  };
  const expiry = "2026-10-18T12:15:00.000Z";

  await assert.rejects(checkApprovedOrderBinding(gateway, "ORDER-1", binding, expiry, Date.parse(expiry)), {
    message: "ADMISSION_EXPIRED"
  });
  assert.equal(calls, 0);
  await assert.rejects(checkApprovedOrderBinding(gateway, "ORDER-1", binding, "invalid", Date.parse(now)), {
    message: "ADMISSION_EXPIRED"
  });
  assert.equal(calls, 0);
});

test("Binding B accepts only an approved order with the admitted binding", async () => {
  const gateway = {
    getOrder: async () => ({ orderId: "ORDER-1", orderStatus: "APPROVED", raw: paypalOrder("APPROVED") })
  };
  await checkApprovedOrderBinding(gateway, "ORDER-1", binding, "2026-10-18T12:15:00.000Z", Date.parse("2026-10-18T12:00:00.000Z"));

  await assert.rejects(checkApprovedOrderBinding({
    getOrder: async () => ({ orderId: "ORDER-1", orderStatus: "CREATED", raw: paypalOrder("CREATED") })
  }, "ORDER-1", binding, "2026-10-18T12:15:00.000Z", Date.parse("2026-10-18T12:00:00.000Z")), {
    message: "PAYPAL_ORDER_NOT_APPROVED"
  });
  await assert.rejects(checkApprovedOrderBinding({
    getOrder: async () => ({ orderId: "ORDER-1", orderStatus: "APPROVED", raw: paypalOrder("APPROVED", {
      purchase_units: [{ ...paypalOrder().purchase_units[0], items: [{ ...paypalOrder().purchase_units[0].items[0], sku: "OTHER-SKU" }] }]
    }) })
  }, "ORDER-1", binding, "2026-10-18T12:15:00.000Z", Date.parse("2026-10-18T12:00:00.000Z")), {
    message: "CART_BINDING_MISMATCH"
  });
  await assert.rejects(checkApprovedOrderBinding({
    getOrder: async () => ({ orderId: "OTHER-ORDER", orderStatus: "APPROVED", raw: paypalOrder("APPROVED") })
  }, "ORDER-1", binding, "2026-10-18T12:15:00.000Z", Date.parse("2026-10-18T12:00:00.000Z")), {
    message: "PAYPAL_ORDER_ID_MISMATCH"
  });
});

function money(value) {
  return { currency_code: binding.currency, value };
}

const now = "2026-10-18T12:00:00.000Z";
