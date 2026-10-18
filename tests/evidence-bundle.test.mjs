import assert from "node:assert/strict";
import test from "node:test";
import canonicalize from "canonicalize";
import { verifyEvidenceBundle } from "../dist/bundle/EvidenceBundle.js";
import { sha256 } from "../dist/domain/Hash.js";

test("verifies payload hashes, the signed chain and a seal against an external key pin", async () => {
  const { bundle, publicKey } = await makeBundle();
  await verifyEvidenceBundle(bundle, new Map([["service-v1", publicKey]]));
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
  const keyId = "service-v1";
  const records = [];
  let previousEventHash = null;
  for (const [index, payload] of [{ admissionId: "admission-1" }, { orderId: "order-1" }].entries()) {
    const unsigned = {
      bundleId: "bundle-1", index, recordType: index === 0 ? "AdmissionRecord" : "BindingA",
      payloadHash: await sha256(canonicalize(payload)), previousEventHash, keyId
    };
    const signatureB64 = Buffer.from(await globalThis.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(canonicalize(unsigned))
    )).toString("base64");
    const record = { index, recordType: unsigned.recordType, payload, payloadHash: unsigned.payloadHash, previousEventHash, keyId, signatureB64 };
    records.push(record);
    previousEventHash = await sha256(canonicalize({ ...unsigned, signatureB64 }));
  }
  const unsignedSeal = {
    schemaVersion: "bundle-seal-v1", bundleId: "bundle-1", recordCount: records.length,
    terminalEventHash: previousEventHash, closureState: "CLOSED_VERIFIED_WEBHOOK",
    sealedAt: "2026-10-18T12:15:00.000Z", keyId
  };
  const signatureB64 = Buffer.from(await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(canonicalize(unsignedSeal))
  )).toString("base64");
  return {
    publicKey,
    bundle: { schemaVersion: "evidence-bundle-v1", bundleId: "bundle-1", records, seal: { ...unsignedSeal, signatureB64 } }
  };
}
