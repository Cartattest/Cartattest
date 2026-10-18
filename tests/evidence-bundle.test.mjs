import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceBundle, verifyEvidenceBundle } from "../dist/bundle/EvidenceBundle.js";

test("verifies payload hashes, the signed chain and a seal against an external key pin", async () => {
  const { bundle, publicKey } = await makeBundle();
  await verifyEvidenceBundle(bundle, new Map([["service-v1", publicKey]]));
});

test("creates a signed bundle the verifier accepts", async () => {
  const { privateKey, publicKey } = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const bundle = await createEvidenceBundle({
    bundleId: "created-1",
    events: [{ recordType: "AdmissionRecord", payload: { admissionId: "admission-1" } }],
    seal: { closureState: "CLOSED_RECONCILED", sealedAt: "2026-10-18T12:15:00.000Z" },
    keyId: "service-v1",
    privateKey
  });
  await verifyEvidenceBundle(bundle, new Map([["service-v1", publicKey]]));
  assert.equal(bundle.seal.recordCount, 1);
});

test("rejects payload tampering and chain changes", async () => {
  const { bundle, publicKey } = await makeBundle();
  await assert.rejects(verifyEvidenceBundle({
    ...bundle,
    records: [{ ...bundle.records[0], payload: { result: "tampered" } }, bundle.records[1]]
  }, new Map([["service-v1", publicKey]])), { message: "BUNDLE_PAYLOAD_HASH_MISMATCH" });
  await assert.rejects(verifyEvidenceBundle({
    ...bundle,
    records: [bundle.records[0], { ...bundle.records[1], previousEventHash: `sha256:${"0".repeat(64)}` }]
  }, new Map([["service-v1", publicKey]])), { message: "BUNDLE_CHAIN_MISMATCH" });
});

test("rejects missing or substituted pinned keys and altered seals", async () => {
  const { bundle, publicKey } = await makeBundle();
  const other = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  await assert.rejects(verifyEvidenceBundle(bundle, new Map()), { message: "BUNDLE_UNTRUSTED_KEY" });
  await assert.rejects(verifyEvidenceBundle(bundle, new Map([["service-v1", other.publicKey]])), { message: "BUNDLE_SIGNATURE_INVALID" });
  await assert.rejects(verifyEvidenceBundle({ ...bundle, seal: { ...bundle.seal, closureState: "CLOSED_RECONCILED" } }, new Map([["service-v1", publicKey]])), {
    message: "BUNDLE_SIGNATURE_INVALID"
  });
});

async function makeBundle() {
  const { privateKey, publicKey } = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    publicKey,
    bundle: await createEvidenceBundle({
      bundleId: "bundle-1",
      events: [
        { recordType: "AdmissionRecord", payload: { admissionId: "admission-1" } },
        { recordType: "BindingA", payload: { orderId: "order-1" } }
      ],
      seal: { closureState: "CLOSED_VERIFIED_WEBHOOK", sealedAt: "2026-10-18T12:15:00.000Z" },
      keyId: "service-v1",
      privateKey
    })
  };
}
