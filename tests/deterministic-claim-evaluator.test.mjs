import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDeterministicClaim } from "../dist/policy/DeterministicClaimEvaluator.js";

const resolved = {
  cartBinding: {
    schemaVersion: "cart-binding-v1",
    intent: "CAPTURE",
    purchaseUnitCount: 1,
    payee: { identityType: "MERCHANT_ID", identityValue: "merchant-1" },
    currency: "GBP",
    amountBreakdown: { total: "99.99" },
    items: [{ sku: "JACKET-BLUE-M", quantity: "2" }]
  }
};

test("checks each supported deterministic claim against resolved cart facts", () => {
  assert.equal(evaluate(claim("BUDGET_MAX", 100, { operator: "LTE", currency: "GBP" })), true);
  assert.equal(evaluate(claim("MERCHANT_EXACT", "merchant-1")), true);
  assert.equal(evaluate(claim("SKU_EXACT", "JACKET-BLUE-M")), true);
  assert.equal(evaluate(claim("VARIANT_EXACT", "blue-medium"), "blue-medium"), true);
  assert.equal(evaluate(claim("QUANTITY_EXACT", 2)), true);
  assert.equal(evaluate(claim("CURRENCY_EXACT", "GBP")), true);
});

test("fails closed on mismatches, unsupported facts, or invalid monetary values", () => {
  assert.equal(evaluate(claim("BUDGET_MAX", 99.98, { operator: "LTE", currency: "GBP" })), false);
  assert.equal(evaluate(claim("BUDGET_MAX", 100, { operator: "LTE", currency: "USD" })), false);
  assert.equal(evaluate(claim("BUDGET_MAX", 100.005, { operator: "LTE", currency: "GBP" })), false);
  assert.equal(evaluate(claim("MERCHANT_EXACT", "merchant-2")), false);
  assert.equal(evaluate(claim("SKU_EXACT", "JACKET-RED-M")), false);
  assert.equal(evaluate(claim("VARIANT_EXACT", "red-medium"), "blue-medium"), false);
  assert.equal(evaluate(claim("QUANTITY_EXACT", 1)), false);
  assert.equal(evaluate(claim("CURRENCY_EXACT", "USD")), false);
  assert.equal(evaluate(claim("TEMPORAL_MAX", "2026-10-20T00:00:00Z")), false);
});

function evaluate(value, variantRef = "blue-medium") {
  return evaluateDeterministicClaim(value, resolved, variantRef);
}

function claim(kind, value, extra = {}) {
  return { claimId: "claim-1", kind, humanText: kind, operator: "EQ", value, overridePolicy: "NEVER", ...extra };
}
