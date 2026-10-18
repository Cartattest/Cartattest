import assert from "node:assert/strict";
import test from "node:test";
import { parseAdmissionRecordV1, parseCaptureAttemptV1 } from "../dist/api/CheckoutRecordValidation.js";

const hashes = {
  claimSetHash: "sha256:claims",
  subjectHash: "sha256:subject",
  resolvedCartSnapshotHash: "sha256:cart",
  admittedCartBindingHash: "sha256:binding"
};
const admission = {
  schemaVersion: "admission-record-v1",
  admissionId: "admission-1",
  ...hashes,
  evidenceManifestVersion: "waterproof-v1",
  evidenceSetHashes: ["sha256:evidence"],
  attestationHashes: ["sha256:attestation"],
  overrideHashes: [],
  policyVersion: "policy-v1",
  cartBindingProfile: "v1",
  paypalOrderId: "order-1",
  outcome: "ALLOW",
  createdAt: "2026-10-18T12:00:00.000Z",
  expiresAt: "2026-10-18T12:15:00.000Z"
};
const attempt = {
  schemaVersion: "capture-attempt-v1",
  attemptId: "attempt-1",
  admissionId: "admission-1",
  paypalOrderId: "order-1",
  materialHash: "sha256:binding",
  paypalRequestId: "request-1",
  state: "IN_FLIGHT",
  createdAt: "2026-10-18T12:01:00.000Z",
  updatedAt: "2026-10-18T12:01:00.000Z"
};

test("parses an ALLOW admission record with a valid expiry window", () => {
  assert.deepEqual(parseAdmissionRecordV1(admission), admission);
});

test("rejects an admission record with unknown fields or an invalid lifetime", () => {
  assert.throws(() => parseAdmissionRecordV1({ ...admission, orderId: "caller-controlled" }), { message: "INVALID_ADMISSION_RECORD" });
  assert.throws(() => parseAdmissionRecordV1({ ...admission, expiresAt: admission.createdAt }), { message: "INVALID_ADMISSION_RECORD" });
});

test("parses a capture attempt and PayPal reconciliation fields", () => {
  const parsed = parseCaptureAttemptV1({ ...attempt, state: "CAPTURE_COMPLETED_PENDING_WEBHOOK", paypalCaptureId: "capture-1", paypalCaptureStatus: "COMPLETED" });
  assert.equal(parsed.paypalCaptureId, "capture-1");
  assert.equal(parsed.paypalCaptureStatus, "COMPLETED");
});

test("rejects invalid capture states, capture statuses and timestamps", () => {
  assert.throws(() => parseCaptureAttemptV1({ ...attempt, state: "DONE" }), { message: "INVALID_CAPTURE_ATTEMPT" });
  assert.throws(() => parseCaptureAttemptV1({ ...attempt, paypalCaptureStatus: "AUTHORIZED" }), { message: "INVALID_CAPTURE_ATTEMPT" });
  assert.throws(() => parseCaptureAttemptV1({ ...attempt, updatedAt: "not-a-date" }), { message: "INVALID_CAPTURE_ATTEMPT" });
});

test("rejects capture states that contradict their persisted PayPal status", () => {
  assert.throws(() => parseCaptureAttemptV1({ ...attempt, state: "CAPTURE_COMPLETED_PENDING_WEBHOOK", paypalCaptureStatus: "FAILED" }), {
    message: "INVALID_CAPTURE_ATTEMPT"
  });
  assert.throws(() => parseCaptureAttemptV1({ ...attempt, state: "CAPTURE_DECLINED", paypalCaptureStatus: "COMPLETED" }), {
    message: "INVALID_CAPTURE_ATTEMPT"
  });
});
