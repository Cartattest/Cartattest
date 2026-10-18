import assert from "node:assert/strict";
import test from "node:test";
import { abortAdmission, abortAwaitingAdmission, attachPaypalOrderAfterBindingA, createAdmission, loadAwaitingAdmission, loadCheckoutStatus } from "../dist/persistence/AdmissionRepository.js";
import { hashCartBinding } from "../dist/binding/CartBindingV1.js";

const binding = { schemaVersion: "cart-binding-v1", intent: "CAPTURE", purchaseUnitCount: 1 };
const bindingHash = await hashCartBinding(binding);
const admission = {
  schemaVersion: "admission-record-v1",
  admissionId: "admission-1",
  claimSetId: "claim-set-1",
  subjectRef: "jacket-1",
  claimSetHash: "sha256:claims",
  subjectHash: "sha256:subject",
  resolvedCartSnapshotHash: "sha256:cart",
  evidenceManifestVersion: "waterproof-v1",
  evidenceSetHashes: ["sha256:evidence"],
  attestationHashes: ["sha256:attestation"],
  overrideHashes: [],
  policyVersion: "policy-v1",
  cartBindingProfile: "v1",
  admittedCartBinding: binding,
  admittedCartBindingHash: bindingHash,
  outcome: "ALLOW",
  createdAt: "2026-10-18T12:00:00.000Z",
  expiresAt: "2026-10-18T12:15:00.000Z"
};

test("stores an ALLOW admission in CREATING_ORDER before any PayPal order is attached", async () => {
  const { pool, calls } = fakePool([{ rows: [{ claimSetHash: admission.claimSetHash }] }, { rows: [] }]);
  await createAdmission(pool, admission);
  assert.match(calls[1].sql, /INSERT INTO admissions/);
  assert.match(calls[1].sql, /NULL, 'CREATING_ORDER'/);
  assert.equal(calls[1].values[13], admission.createdAt);
});

test("refuses an admission whose Claim Set hash differs from persisted content", async () => {
  const { pool, calls } = fakePool([{ rows: [{ claimSetHash: "sha256:other" }] }]);
  await assert.rejects(createAdmission(pool, admission), { message: "CLAIM_SET_INTEGRITY_FAILURE" });
  assert.equal(calls.some((call) => call.sql.startsWith("INSERT INTO admissions")), false);
});

test("attaches the order only while Binding A admission is live and pending", async () => {
  const { pool, calls } = fakePool([{ rows: [{ admissionId: "admission-1" }] }]);
  await attachPaypalOrderAfterBindingA(pool, "admission-1", "order-1", "2026-10-18T12:01:00.000Z");
  assert.match(calls[0].sql, /state = 'AWAITING_APPROVAL'/);
  assert.deepEqual(calls[0].values, ["admission-1", "order-1", "2026-10-18T12:01:00.000Z"]);
});

test("loads an unexpired admission with its server-side order and binding", async () => {
  const { claimSetId, subjectRef, admittedCartBinding, ...record } = admission;
  const row = {
    ...record,
    paypalOrderId: "order-1",
    admissionState: "AWAITING_APPROVAL",
    subjectRef,
    admittedCartBinding
  };
  const { pool } = fakePool([{ rows: [row] }]);
  const loaded = await loadAwaitingAdmission(pool, "admission-1", "2026-10-18T12:02:00.000Z");
  assert.equal(loaded.record.paypalOrderId, "order-1");
  assert.deepEqual(loaded.admittedCartBinding, binding);
});

test("rejects missing, expired or non-pending admissions", async () => {
  const { pool } = fakePool([{ rows: [] }]);
  await assert.rejects(loadAwaitingAdmission(pool, "admission-1", "2026-10-18T12:16:00.000Z"), { message: "ADMISSION_NOT_CAPTUREABLE" });
});

test("aborts an admission that cannot complete order creation", async () => {
  const { pool, calls } = fakePool([{ rows: [{ admissionId: "admission-1" }] }]);
  await abortAdmission(pool, "admission-1");
  assert.match(calls[0].sql, /SET state = 'ABORTED'/);
  assert.match(calls[0].sql, /state = 'CREATING_ORDER'/);
});

test("aborts only an admission that is still awaiting buyer approval", async () => {
  const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }]);
  await abortAwaitingAdmission(pool, "admission-1");
  assert.match(calls[0].sql, /SET state = 'ABORTED'/);
  assert.match(calls[0].sql, /state = 'AWAITING_APPROVAL'/);
  assert.deepEqual(calls[0].values, ["admission-1"]);
});

test("loads checkout status without exposing the PayPal order ID", async () => {
  const { pool, calls } = fakePool([{ rows: [{
    admissionState: "CAPTURE_STARTED", expiresAt: admission.expiresAt,
    captureState: "CAPTURE_PENDING", captureStatus: "PENDING"
  }] }]);
  const status = await loadCheckoutStatus(pool, "admission-1");
  assert.deepEqual(status, {
    admissionState: "CAPTURE_STARTED", expiresAt: admission.expiresAt,
    capture: { state: "CAPTURE_PENDING", status: "PENDING" }
  });
  assert.doesNotMatch(calls[0].sql, /paypal_order_id/);
});

function fakePool(results) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return results.shift() ?? { rows: [], rowCount: 1 };
    },
    release() {}
  };
  return { pool: { async connect() { return client; } }, calls };
}
