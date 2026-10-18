import assert from "node:assert/strict";
import test from "node:test";
import { nextCaptureState } from "../dist/execution/CaptureStateMachine.js";

test("a pending capture can close after GET reconciliation confirms completion", () => {
  assert.equal(nextCaptureState("CAPTURE_PENDING", "RECONCILED_COMPLETED"), "CLOSED_RECONCILED");
});

test("a pending capture records a PayPal decline distinctly from a generic failure", () => {
  assert.equal(nextCaptureState("CAPTURE_PENDING", "PAYPAL_DECLINED"), "CAPTURE_DECLINED");
});

test("ambiguous capture is reconciled before it can close", () => {
  assert.equal(nextCaptureState("IN_FLIGHT", "AMBIGUOUS_RESPONSE"), "EXECUTION_UNKNOWN");
  assert.equal(nextCaptureState("EXECUTION_UNKNOWN", "RECONCILED_COMPLETED"), "CLOSED_RECONCILED");
});
