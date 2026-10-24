import assert from "node:assert/strict";
import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import test from "node:test";
import canonicalize from "canonicalize";
import { verifyBuyerOverrideSignature, verifyClaimSetSignature } from "../dist/security/BuyerSignatures.js";

const generate = promisify(generateKeyPair);
const keys = await generate("ec", { namedCurve: "prime256v1" });
const privateKey = await crypto.subtle.importKey("pkcs8", keys.privateKey.export({ format: "der", type: "pkcs8" }),
  { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const publicKey = await crypto.subtle.importKey("spki", keys.publicKey.export({ format: "der", type: "spki" }),
  { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const trustedKeys = new Map([["buyer-1", publicKey]]);

test("verifies a signature over the unsigned canonical ClaimSet", async () => {
  const claimSet = { schemaVersion: "claim-set-v1", claimSetId: "claims-1", buyerRequestText: "one jacket", claims: [],
    createdAt: "2026-10-20T12:00:00.000Z", expiresAt: "2026-10-20T12:10:00.000Z" };
  const signed = { ...claimSet, buyerSignature: await signatureFor(claimSet) };
  assert.equal(await verifyClaimSetSignature(signed, trustedKeys), true);
  assert.equal(await verifyClaimSetSignature({ ...signed, buyerRequestText: "two jackets" }, trustedKeys), false);
  assert.equal(await verifyClaimSetSignature(signed, new Map()), false);
});

test("verifies buyer overrides over every scope-binding field", async () => {
  const override = { schemaVersion: "buyer-override-v1", overrideId: "override-1", claimSetHash: hash("1"), claimId: "claim-1",
    subjectRef: "jacket-1", subjectHash: hash("2"), evidenceSetHash: hash("3"), attestationHash: hash("4"),
    decision: "ACCEPT_EXCEPTION", expiresAt: "2026-10-20T12:10:00.000Z", nonce: "nonce-1" };
  const signed = { ...override, buyerSignature: await signatureFor(override) };
  assert.equal(await verifyBuyerOverrideSignature(signed, trustedKeys), true);
  assert.equal(await verifyBuyerOverrideSignature({ ...signed, subjectRef: "jacket-2" }, trustedKeys), false);
});

async function signatureFor(payload) {
  const message = new TextEncoder().encode(canonicalize(payload));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, message));
  return { alg: "ES256", keyId: "buyer-1", signatureB64: Buffer.from(signature).toString("base64") };
}

function hash(value) { return "sha256:" + value.repeat(64); }
