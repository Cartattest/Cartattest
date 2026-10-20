import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvidenceBundle } from "../dist/application/FinalizeEvidenceBundle.js";
import { verifyEvidenceBundle } from "../dist/bundle/EvidenceBundle.js";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const signing = { keyId: "service-test", privateKey: pair.privateKey, trustedKeys: new Map([["service-test", pair.publicKey]]) };
const snapshot = {
  schemaVersion: "checkout-evidence-snapshot-v1",
  claimSet: { schemaVersion: "claim-set-v1", claimSetId: "claims-1", claims: [] },
  resolvedSelection: { subjectRef: "item-1", cartBinding: { items: [{ name: "Item" }] } },
  claimEvaluations: []
};
const closedAdmission = {
  admissionId: "admission-1", claimHash: "sha256:claims", subjectRef: "item-1", subjectHash: "sha256:subject",
  resolvedCartSnapshotHash: "sha256:cart", evidenceManifestVersion: "none", evidenceSetHashes: [],
  attestationHashes: [], overrideHashes: [], policyVersion: "policy-v1", cartBindingProfile: "v1",
  admittedCartBinding: { items: [] }, admittedCartBindingHash: "sha256:binding", paypalOrderId: "ORDER-1",
  createdAt: "2026-10-20T12:00:00.000Z", expiresAt: "2026-10-20T12:15:00.000Z", evidenceSnapshot: snapshot,
  attemptId: "attempt-1", materialHash: "sha256:binding", paypalRequestId: "request-1",
  captureState: "CLOSED_RECONCILED", captureId: "CAPTURE-1", captureStatus: "COMPLETED",
  captureCreatedAt: "2026-10-20T12:01:00.000Z", sealedAt: "2026-10-20T12:02:00.000Z"
};

test("seals a closed admission once and verifies the signed event chain", async () => {
  const { pool, calls } = fakePool({ admission: closedAdmission });
  const bundle = await finalizeEvidenceBundle(pool, "admission-1", signing);
  await verifyEvidenceBundle(bundle, signing.trustedKeys);
  assert.equal(bundle.seal.closureState, "CLOSED_RECONCILED");
  assert.equal(bundle.seal.captureId, "CAPTURE-1");
  assert.deepEqual(bundle.records.map((record) => record.recordType), [
    "BuyerClaimSet", "ResolvedSelection", "AdmissionRecord", "BindingA", "PayPalApproval", "BindingB", "CaptureAttempt"
  ]);
  assert.equal(calls.filter((sql) => sql.startsWith("INSERT INTO evidence_bundles")).length, 1);
});

test("does not seal an admission until both records show a terminal closed state", async () => {
  const { pool, calls } = fakePool({ admission: null });
  await assert.rejects(finalizeEvidenceBundle(pool, "admission-1", signing), { message: "CLOSED_ADMISSION_NOT_FOUND" });
  assert.equal(calls.some((sql) => sql.startsWith("INSERT INTO evidence_bundles")), false);
});

test("returns an existing verified bundle without querying admission data again", async () => {
  const bundle = await finalizeEvidenceBundle(fakePool({ admission: closedAdmission }).pool, "admission-1", signing);
  const { pool, calls } = fakePool({ existing: bundle, admission: closedAdmission });
  assert.deepEqual(await finalizeEvidenceBundle(pool, "admission-1", signing), bundle);
  assert.equal(calls.length, 1);
});

function fakePool({ admission, existing } = {}) {
  const calls = [];
  let saved;
  return { calls, pool: { async connect() { return {
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.startsWith("SELECT bundle FROM evidence_bundles")) return { rows: existing || saved ? [{ bundle: existing || saved }] : [] };
      if (sql.startsWith("SELECT a.admission_id")) return { rows: admission ? [admission] : [] };
      if (sql.startsWith("SELECT event_id")) return { rows: [] };
      if (sql.startsWith("INSERT INTO evidence_bundles")) { saved = values[1]; return { rows: [{ bundle_id: values[0] }] }; }
      return { rows: [], rowCount: 1 };
    }, release() {}
  }; } } };
}
