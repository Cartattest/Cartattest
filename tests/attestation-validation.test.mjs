import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../dist/domain/Hash.js";
import { validateSemanticAttestation } from "../dist/attestor/AttestationValidation.js";

const now = "2026-10-18T12:00:00.000Z";
const promptHash = await sha256("prompt");
const configHash = await sha256("config");
const subjectHash = await sha256("subject");
const evidenceSetHash = await sha256("evidence");
const config = {
  provider: "test-provider",
  modelId: "test-model-v1",
  temperature: 0,
  topP: 1,
  maxOutputTokens: 256,
  promptHash,
  configHash,
  attestorVersion: "attestor-v1"
};
const rawContent = "Waterproof and seam-sealed shell rated to 20,000 mm.";
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
const context = { claimId: "waterproof", subjectHash, evidenceSetHash, evidence, config };
const attestation = {
  schemaVersion: "semantic-attestation-v1",
  attestationId: "att-1",
  claimId: "waterproof",
  subjectHash: context.subjectHash,
  evidenceSetHash: context.evidenceSetHash,
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

test("accepts an attestation bound to the claim, subject, evidence and frozen config", () => {
  assert.deepEqual(validateSemanticAttestation(attestation, context), attestation);
});

test("rejects mismatched claim, subject, evidence set or config bindings", () => {
  for (const changed of [
    { claimId: "other-claim" },
    { subjectHash: "sha256:other-subject" },
    { evidenceSetHash: "sha256:other-evidence" },
    { modelId: "other-model" },
    { promptHash: "sha256:other-prompt" },
    { configHash: "sha256:other-config" }
  ]) {
    assert.throws(() => validateSemanticAttestation({ ...attestation, ...changed }, context), {
      message: "INVALID_SEMANTIC_ATTESTATION"
    });
  }
});

test("rejects quotes that are not verbatim in the referenced evidence model view", () => {
  assert.throws(() => validateSemanticAttestation({
    ...attestation,
    supportQuotes: [{ evidenceId: "spec-1", verbatim: "Rated to 30,000 mm" }]
  }, context), { message: "INVALID_SEMANTIC_ATTESTATION" });
  assert.throws(() => validateSemanticAttestation({
    ...attestation,
    supportQuotes: [{ evidenceId: "unknown", verbatim: "Waterproof" }]
  }, context), { message: "INVALID_SEMANTIC_ATTESTATION" });
});

test("requires evidence-based quotes for supported and contradicted results", () => {
  assert.throws(() => validateSemanticAttestation({ ...attestation, supportQuotes: [] }, context), {
    message: "INVALID_SEMANTIC_ATTESTATION"
  });
  assert.throws(() => validateSemanticAttestation({
    ...attestation,
    result: "CONTRADICTED",
    supportQuotes: [],
    contradictionQuotes: []
  }, context), { message: "INVALID_SEMANTIC_ATTESTATION" });
  assert.equal(validateSemanticAttestation({ ...attestation, result: "UNPROVEN", supportQuotes: [] }, context).result, "UNPROVEN");
});

test("rejects evidence hashes outside the frozen evidence set", async () => {
  const alienHash = await sha256("not in evidence");
  assert.throws(() => validateSemanticAttestation({ ...attestation, evidenceHashes: [alienHash] }, context), {
    message: "INVALID_SEMANTIC_ATTESTATION"
  });
});
