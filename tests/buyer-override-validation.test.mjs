import assert from "node:assert/strict";
import test from "node:test";
import { parseBuyerOverrideV1 } from "../dist/api/BuyerOverrideValidation.js";

const override = {
  schemaVersion: "buyer-override-v1", overrideId: "override-1", claimSetHash: `sha256:${"1".repeat(64)}`,
  claimId: "waterproof", subjectRef: "jacket-1", subjectHash: `sha256:${"2".repeat(64)}`,
  evidenceSetHash: `sha256:${"3".repeat(64)}`, attestationHash: `sha256:${"4".repeat(64)}`,
  decision: "ACCEPT_EXCEPTION", expiresAt: "2026-10-18T12:10:00.000Z", nonce: "nonce-1",
  buyerSignature: { alg: "ES256", keyId: "buyer-1", signatureB64: `${"A".repeat(86)}==` }
};

test("parses a scoped buyer exception with only the signed contract fields", () => {
  assert.deepEqual(parseBuyerOverrideV1(override), override);
});

test("rejects extra fields and malformed hashes or signatures", () => {
  assert.throws(() => parseBuyerOverrideV1({ ...override, paypalOrderId: "order-1" }), { message: "INVALID_BUYER_OVERRIDE" });
  assert.throws(() => parseBuyerOverrideV1({ ...override, subjectHash: "sha256:bad" }), { message: "INVALID_BUYER_OVERRIDE" });
  assert.throws(() => parseBuyerOverrideV1({ ...override, buyerSignature: { ...override.buyerSignature, signatureB64: "bad" } }), { message: "INVALID_BUYER_OVERRIDE" });
});
