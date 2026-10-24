import assert from "node:assert/strict";
import test from "node:test";
import { hashEvidenceSet } from "../dist/bundle/EvidenceSet.js";
import { sha256 } from "../dist/domain/Hash.js";
import { CachedSemanticAttestor } from "../dist/attestor/CachedSemanticAttestor.js";

const now = "2026-10-18T12:00:00.000Z";
const config = {
  provider: "test-provider",
  modelId: "test-model-v1",
  temperature: 0,
  topP: 1,
  maxOutputTokens: 256,
  promptHash: await sha256("prompt"),
  configHash: await sha256("config"),
  attestorVersion: "attestor-v1"
};
const rawContent = "Waterproof and seam-sealed shell.";
const evidence = [{
  schemaVersion: "merchant-evidence-v1",
  evidenceId: "spec-1",
  subjectRef: "jacket-1",
  sourceClass: "MERCHANT_TECHNICAL_SPEC",
  origin: "fixture://merchant/products/jacket-1",
  fieldLocator: "spec.shell",
  retrievedAt: now,
  rawContent,
  rawHash: await sha256(rawContent),
  modelView: rawContent,
  modelViewHash: await sha256(rawContent)
}];
const evidenceSetHash = await hashEvidenceSet(evidence);
const args = {
  claimSetHash: await sha256("claim-set"),
  claim: {
    claimId: "waterproof",
    kind: "SEMANTIC_BOOLEAN",
    humanText: "Must be waterproof",
    operator: "SUPPORTED",
    value: true,
    evidenceProfileId: "waterproof-v1",
    overridePolicy: "HUMAN_EXACT_SUBJECT"
  },
  subjectHash: await sha256("subject"),
  manifest: { schemaVersion: "evidence-manifest-v1" },
  evidence,
  config
};

test("memoizes identical valid attestation requests", async () => {
  let calls = 0;
  const cached = new CachedSemanticAttestor({ attest: async () => { calls++; return validAttestation(); } }, () => new Date(now));
  const first = await cached.attest(args);
  const second = await cached.attest(args);

  assert.equal(calls, 1);
  assert.strictEqual(first, second);
});

test("coalesces concurrent identical requests", async () => {
  let calls = 0;
  const cached = new CachedSemanticAttestor({
    attest: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return validAttestation();
    }
  }, () => new Date(now));

  const [first, second] = await Promise.all([cached.attest(args), cached.attest(args)]);
  assert.equal(calls, 1);
  assert.strictEqual(first, second);
});

test("converts an invalid attestation to cached UNPROVEN without a reroll", async () => {
  let calls = 0;
  const cached = new CachedSemanticAttestor({ attest: async () => {
    calls++;
    return { ...validAttestation(), claimId: "other-claim" };
  } }, () => new Date(now));

  const first = await cached.attest(args);
  const second = await cached.attest(args);
  assert.equal(calls, 1);
  assert.strictEqual(first, second);
  assert.equal(first.result, "UNPROVEN");
  assert.deepEqual(first.supportQuotes, []);
});

test("retries after a transport failure without caching the failure", async () => {
  let calls = 0;
  const cached = new CachedSemanticAttestor({ attest: async () => {
    calls++;
    if (calls === 1) throw new Error("transport failed");
    return validAttestation();
  } }, () => new Date(now));

  await assert.rejects(cached.attest(args), /transport failed/);
  assert.equal((await cached.attest(args)).result, "SUPPORTED");
  assert.equal(calls, 2);
});

function validAttestation() {
  return {
    schemaVersion: "semantic-attestation-v1",
    attestationId: "att-1",
    claimId: args.claim.claimId,
    subjectHash: args.subjectHash,
    evidenceSetHash,
    evidenceHashes: [evidence[0].rawHash],
    result: "SUPPORTED",
    supportQuotes: [{ evidenceId: "spec-1", verbatim: "Waterproof and seam-sealed shell" }],
    contradictionQuotes: [],
    modelId: config.modelId,
    attestorVersion: config.attestorVersion,
    promptHash: config.promptHash,
    configHash: config.configHash,
    createdAt: now
  };
}
