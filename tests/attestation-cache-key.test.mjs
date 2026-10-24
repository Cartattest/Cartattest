import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../dist/domain/Hash.js";
import { hashAttestationCacheKey } from "../dist/attestor/AttestationCacheKey.js";

const base = {
  claimSetHash: await sha256("claim-set"),
  claimId: "waterproof",
  subjectHash: await sha256("subject"),
  evidenceSetHash: await sha256("evidence-set"),
  attestorConfigHash: await sha256("attestor-config")
};

test("hashes the same five-part attestation identity deterministically", async () => {
  assert.equal(await hashAttestationCacheKey(base), await hashAttestationCacheKey({ ...base }));
  assert.match(await hashAttestationCacheKey(base), /^sha256:[0-9a-f]{64}$/);
});

test("changes the cache key when any identity component changes", async () => {
  const baseHash = await hashAttestationCacheKey(base);
  for (const changed of [
    { claimSetHash: await sha256("other-claim-set") },
    { claimId: "different-claim" },
    { subjectHash: await sha256("other-subject") },
    { evidenceSetHash: await sha256("other-evidence-set") },
    { attestorConfigHash: await sha256("other-config") }
  ]) {
    assert.notEqual(await hashAttestationCacheKey({ ...base, ...changed }), baseHash);
  }
});

test("rejects incomplete cache identity", async () => {
  await assert.rejects(hashAttestationCacheKey({ ...base, claimId: " " }), { message: "INVALID_ATTESTATION_CACHE_KEY" });
  await assert.rejects(hashAttestationCacheKey({ ...base, subjectHash: "sha256:bad" }), {
    message: "INVALID_ATTESTATION_CACHE_KEY"
  });
});
