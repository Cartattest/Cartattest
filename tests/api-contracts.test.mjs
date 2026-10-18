import assert from "node:assert/strict";
import test from "node:test";
import { parseCompleteCheckoutRequest, parseSubmitSelectionRequest } from "../dist/api/contracts.js";

test("accepts identifier-only selection input", () => {
  assert.deepEqual(parseSubmitSelectionRequest({
    claimSetId: "claim-set-1",
    subjectRef: "jacket-1",
    variantRef: "blue-m",
    quantity: 2,
    fulfillmentRef: "ie-standard"
  }), {
    claimSetId: "claim-set-1",
    subjectRef: "jacket-1",
    variantRef: "blue-m",
    quantity: 2,
    fulfillmentRef: "ie-standard"
  });
});

test("rejects caller-supplied facts and PayPal operations", () => {
  const request = {
    claimSetId: "claim-set-1",
    subjectRef: "jacket-1",
    variantRef: "blue-m",
    quantity: 1,
    fulfillmentRef: "ie-standard"
  };
  for (const forbidden of [
    { price: "0.01" },
    { evidence: [] },
    { sourceClass: "MERCHANT_TECHNICAL_SPEC" },
    { paypalOrderId: "ORDER-1" },
    { paypalOperation: "capture" }
  ]) {
    assert.throws(() => parseSubmitSelectionRequest({ ...request, ...forbidden }), { message: "INVALID_SUBMIT_SELECTION_REQUEST" });
  }
});

test("rejects invalid identifiers and quantities", () => {
  const request = {
    claimSetId: "claim-set-1",
    subjectRef: "jacket-1",
    variantRef: "blue-m",
    quantity: 1,
    fulfillmentRef: "ie-standard"
  };
  assert.throws(() => parseSubmitSelectionRequest(null), { message: "INVALID_SUBMIT_SELECTION_REQUEST" });
  assert.throws(() => parseSubmitSelectionRequest({ ...request, subjectRef: " " }), { message: "INVALID_SUBMIT_SELECTION_REQUEST" });
  assert.throws(() => parseSubmitSelectionRequest({ ...request, quantity: 0 }), { message: "INVALID_SUBMIT_SELECTION_REQUEST" });
  assert.throws(() => parseSubmitSelectionRequest({ ...request, quantity: 1.5 }), { message: "INVALID_SUBMIT_SELECTION_REQUEST" });
});

test("completion accepts only a server-resolved admission ID", () => {
  assert.deepEqual(parseCompleteCheckoutRequest({ admissionId: "admission-1" }), { admissionId: "admission-1" });
  assert.throws(() => parseCompleteCheckoutRequest({ admissionId: "admission-1", orderId: "ORDER-1" }), {
    message: "INVALID_COMPLETE_CHECKOUT_REQUEST"
  });
});
