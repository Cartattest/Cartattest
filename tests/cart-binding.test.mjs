import assert from "node:assert/strict";
import test from "node:test";
import * as cartBinding from "../dist/binding/CartBindingV1.js";

const order = {
  id: "SANDBOX-ORDER-1",
  status: "APPROVED",
  intent: "CAPTURE",
  application_context: { shipping_preference: "SET_PROVIDED_ADDRESS" },
  payer: { name: { given_name: "Buyer" } },
  links: [{ rel: "approve", href: "https://paypal.example/approve" }],
  purchase_units: [{
    payee: { merchant_id: "MERCHANT-1", email_address: "seller@example.test" },
    amount: {
      currency_code: "GBP",
      value: "25.50",
      breakdown: {
        item_total: { currency_code: "GBP", value: "20.00" },
        tax_total: { currency_code: "GBP", value: "2.00" },
        shipping: { currency_code: "GBP", value: "3.50" }
      }
    },
    shipping: {
      name: { full_name: "Test Buyer" },
      address: {
        address_line_1: "1 Test Street",
        admin_area_2: "Dublin",
        postal_code: "D02TEST",
        country_code: "IE"
      },
      options: [{
        id: "standard",
        label: "Standard",
        type: "SHIPPING",
        amount: { currency_code: "GBP", value: "3.50" },
        selected: true
      }]
    },
    items: [{
      name: "Waterproof Shell",
      sku: "SHELL-BLUE-M",
      quantity: "1",
      unit_amount: { currency_code: "GBP", value: "20.00" },
      tax: { currency_code: "GBP", value: "2.00" }
    }]
  }]
};

test("maps one approved PayPal purchase unit and ignores non-material response metadata", () => {
  const binding = cartBinding.mapPayPalOrderToBinding(order);

  assert.deepEqual(binding, {
    schemaVersion: "cart-binding-v1",
    intent: "CAPTURE",
    purchaseUnitCount: 1,
    payee: { identityType: "MERCHANT_ID", identityValue: "MERCHANT-1" },
    currency: "GBP",
    amountBreakdown: {
      itemTotal: "20.00",
      taxTotal: "2.00",
      shipping: "3.50",
      handling: "0.00",
      insurance: "0.00",
      shippingDiscount: "0.00",
      discount: "0.00",
      total: "25.50"
    },
    shipping: {
      preference: "SET_PROVIDED_ADDRESS",
      name: "Test Buyer",
      address: {
        addressLine1: "1 Test Street",
        adminArea2: "Dublin",
        postalCode: "D02TEST",
        countryCode: "IE"
      },
      optionId: "standard",
      type: "SHIPPING",
      amount: "3.50"
    },
    items: [{ name: "Waterproof Shell", sku: "SHELL-BLUE-M", quantity: "1", unitAmount: "20.00", tax: "2.00" }]
  });
});

test("compares fixed-address shipping by address and charge when PayPal omits unsupported options", () => {
  const expected = cartBinding.mapPayPalOrderToBinding(order);
  const fixedAddressOrder = structuredClone(order);
  delete fixedAddressOrder.purchase_units[0].shipping.options;
  const actual = cartBinding.mapPayPalOrderToBinding(fixedAddressOrder);

  assert.equal(actual.shipping.amount, "3.50");
  assert.equal(actual.shipping.optionId, undefined);
  assert.doesNotThrow(() => cartBinding.assertBindingEqual(expected, actual));
});

test("binds every material PayPal field", () => {
  const expected = cartBinding.mapPayPalOrderToBinding(order);
  const mutations = [
    ["payee", (value) => { value.purchase_units[0].payee.merchant_id = "MERCHANT-2"; }],
    ["currency", (value) => {
      value.purchase_units[0].amount.currency_code = "EUR";
      value.purchase_units[0].amount.breakdown.item_total.currency_code = "EUR";
      value.purchase_units[0].amount.breakdown.tax_total.currency_code = "EUR";
      value.purchase_units[0].amount.breakdown.shipping.currency_code = "EUR";
      value.purchase_units[0].shipping.options[0].amount.currency_code = "EUR";
      value.purchase_units[0].items[0].unit_amount.currency_code = "EUR";
      value.purchase_units[0].items[0].tax.currency_code = "EUR";
    }],
    ["total", (value) => { value.purchase_units[0].amount.value = "25.51"; }],
    ["item total", (value) => { value.purchase_units[0].amount.breakdown.item_total.value = "20.01"; }],
    ["tax total", (value) => { value.purchase_units[0].amount.breakdown.tax_total.value = "2.01"; }],
    ["shipping total", (value) => { value.purchase_units[0].amount.breakdown.shipping.value = "3.51"; }],
    ["handling", (value) => { value.purchase_units[0].amount.breakdown.handling = { currency_code: "GBP", value: "0.01" }; }],
    ["insurance", (value) => { value.purchase_units[0].amount.breakdown.insurance = { currency_code: "GBP", value: "0.01" }; }],
    ["shipping discount", (value) => { value.purchase_units[0].amount.breakdown.shipping_discount = { currency_code: "GBP", value: "0.01" }; }],
    ["discount", (value) => { value.purchase_units[0].amount.breakdown.discount = { currency_code: "GBP", value: "0.01" }; }],
    ["shipping name", (value) => { value.purchase_units[0].shipping.name.full_name = "Another Buyer"; }],
    ["address line 1", (value) => { value.purchase_units[0].shipping.address.address_line_1 = "2 Test Street"; }],
    ["address line 2", (value) => { value.purchase_units[0].shipping.address.address_line_2 = "Flat 2"; }],
    ["city", (value) => { value.purchase_units[0].shipping.address.admin_area_2 = "Cork"; }],
    ["region", (value) => { value.purchase_units[0].shipping.address.admin_area_1 = "Leinster"; }],
    ["postal code", (value) => { value.purchase_units[0].shipping.address.postal_code = "T12TEST"; }],
    ["country", (value) => { value.purchase_units[0].shipping.address.country_code = "GB"; }],
    ["shipping option id", (value) => { value.purchase_units[0].shipping.options[0].id = "express"; }],
    ["shipping option type", (value) => { value.purchase_units[0].shipping.options[0].type = "PICKUP"; }],
    ["shipping option amount", (value) => { value.purchase_units[0].shipping.options[0].amount.value = "4.00"; }],
    ["item name", (value) => { value.purchase_units[0].items[0].name = "Different Shell"; }],
    ["variant SKU", (value) => { value.purchase_units[0].items[0].sku = "SHELL-RED-L"; }],
    ["quantity", (value) => { value.purchase_units[0].items[0].quantity = "2"; }],
    ["unit amount", (value) => { value.purchase_units[0].items[0].unit_amount.value = "21.00"; }],
    ["item tax", (value) => { value.purchase_units[0].items[0].tax.value = "2.01"; }]
  ];

  for (const [field, mutate] of mutations) {
    const changed = structuredClone(order);
    mutate(changed);
    assert.throws(
      () => cartBinding.assertBindingEqual(expected, cartBinding.mapPayPalOrderToBinding(changed)),
      { message: "CART_BINDING_MISMATCH" },
      `${field} must be bound`
    );
  }
});

test("ignores PayPal payer, link and non-material metadata changes", () => {
  const changed = structuredClone(order);
  changed.payer = { payer_id: "DIFFERENT-PAYER", email_address: "other@example.test" };
  changed.links = [{ rel: "approve", href: "https://different.example/approve" }];
  changed.update_time = "2026-10-18T13:00:00Z";
  changed.purchase_units[0].custom_id = "changed-custom-id";

  assert.doesNotThrow(() => cartBinding.assertBindingEqual(
    cartBinding.mapPayPalOrderToBinding(order),
    cartBinding.mapPayPalOrderToBinding(changed)
  ));
});

test("rejects an order that does not have exactly one purchase unit", () => {
  assert.throws(() => cartBinding.mapPayPalOrderToBinding({ ...order, purchase_units: [...order.purchase_units, ...order.purchase_units] }), {
    message: "UNSUPPORTED_PURCHASE_UNIT_COUNT"
  });
});

test("rejects a changed intent and mutable shipping preference", () => {
  assert.throws(() => cartBinding.mapPayPalOrderToBinding({ ...order, intent: "AUTHORIZE" }), {
    message: "UNSUPPORTED_PAYPAL_INTENT"
  });
  assert.throws(() => cartBinding.mapPayPalOrderToBinding({
    ...order,
    application_context: { shipping_preference: "GET_FROM_FILE" }
  }), { message: "FIXED_SHIPPING_REQUIRED" });
});

test("binding equality uses canonical JSON rather than object insertion order", () => {
  assert.doesNotThrow(() => cartBinding.assertBindingEqual({ a: 1, b: 2 }, { b: 2, a: 1 }));
});

test("hashes objects with RFC 8785 property ordering and a sha256 prefix", async () => {
  assert.equal(await cartBinding.hashCartBinding({ b: 2, a: 1 }), "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
});
