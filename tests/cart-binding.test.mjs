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

test("rejects an order that does not have exactly one purchase unit", () => {
  assert.throws(() => cartBinding.mapPayPalOrderToBinding({ ...order, purchase_units: [...order.purchase_units, ...order.purchase_units] }), {
    message: "UNSUPPORTED_PURCHASE_UNIT_COUNT"
  });
});

test("binding equality uses canonical JSON rather than object insertion order", () => {
  assert.doesNotThrow(() => cartBinding.assertBindingEqual({ a: 1, b: 2 }, { b: 2, a: 1 }));
});

test("hashes objects with RFC 8785 property ordering and a sha256 prefix", async () => {
  assert.equal(await cartBinding.hashCartBinding({ b: 2, a: 1 }), "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
});
