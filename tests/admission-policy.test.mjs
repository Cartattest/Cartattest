import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAdmission } from "../dist/policy/AdmissionPolicy.js";

const now = "2026-10-18T12:00:00.000Z";
const hashes = {
  claimSetHash: "sha256:claims",
  subjectHash: "sha256:subject",
  evidenceSetHash: "sha256:evidence",
  attestationHash: "sha256:attestation"
};

test("blocks a failed non-relaxable budget claim even when an override is supplied", () => {
  const outcome = evaluateAdmission([{
    claim: { claimId: "budget", kind: "BUDGET_MAX", humanText: "Under GBP 100", operator: "LTE", value: 100, currency: "GBP", overridePolicy: "NEVER" },
    deterministicSatisfied: false,
    integrityValid: true,
    provenanceValid: true,
    evidenceComplete: true,
    ...hashes,
    subjectRef: "jacket-1",
    override: overrideFor("budget")
  }], { now, verifyOverride: () => true });

  assert.deepEqual(outcome, { status: "BLOCK", reason: "NON_RELAXABLE_CLAIM_FAILED" });
});

test("steps up on unproven semantic evidence and never allows it", () => {
  const outcome = evaluateAdmission([semanticEvaluation("UNPROVEN")], { now });
  assert.deepEqual(outcome, { status: "STEP_UP", claimIds: ["waterproof"] });
});

test("allows a supported semantic claim only with complete evidence and valid provenance", () => {
  const outcome = evaluateAdmission([semanticEvaluation("SUPPORTED")], { now });
  assert.deepEqual(outcome, { status: "ALLOW" });
});

test("a scoped exact-subject override permits the same frozen semantic attestation", () => {
  const evaluation = semanticEvaluation("CONTRADICTED");
  evaluation.override = overrideFor("waterproof");
  const outcome = evaluateAdmission([evaluation], { now, verifyOverride: () => true });
  assert.deepEqual(outcome, { status: "ALLOW" });
});

test("rejects an override reused against a different subject hash", () => {
  const evaluation = semanticEvaluation("CONTRADICTED");
  evaluation.override = { ...overrideFor("waterproof"), subjectHash: "sha256:other-subject" };
  const outcome = evaluateAdmission([evaluation], { now, verifyOverride: () => true });
  assert.deepEqual(outcome, { status: "BLOCK", reason: "INVALID_OVERRIDE" });
});

test("blocks integrity or provenance failures before semantic STEP-UP", () => {
  const evaluation = semanticEvaluation("UNPROVEN");
  evaluation.provenanceValid = false;
  assert.deepEqual(evaluateAdmission([evaluation], { now }), { status: "BLOCK", reason: "PROVENANCE_FAILURE" });
});

test("steps up when required evidence is missing even if the attestor says supported", () => {
  const evaluation = semanticEvaluation("SUPPORTED");
  evaluation.evidenceComplete = false;
  assert.deepEqual(evaluateAdmission([evaluation], { now }), { status: "STEP_UP", claimIds: ["waterproof"] });
});

test("blocks a matching override if its signature verifier rejects it", () => {
  const evaluation = semanticEvaluation("CONTRADICTED");
  evaluation.override = overrideFor("waterproof");
  assert.deepEqual(evaluateAdmission([evaluation], { now, verifyOverride: () => false }), {
    status: "BLOCK",
    reason: "INVALID_OVERRIDE"
  });
});

test("blocks expired exact-subject overrides", () => {
  const evaluation = semanticEvaluation("CONTRADICTED");
  evaluation.override = { ...overrideFor("waterproof"), expiresAt: "2026-10-18T11:59:59.000Z" };
  assert.deepEqual(evaluateAdmission([evaluation], { now, verifyOverride: () => true }), {
    status: "BLOCK",
    reason: "INVALID_OVERRIDE"
  });
});

function semanticEvaluation(result) {
  return {
    claim: {
      claimId: "waterproof",
      kind: "SEMANTIC_BOOLEAN",
      humanText: "Waterproof",
      operator: "SUPPORTED",
      value: true,
      evidenceProfileId: "waterproof-v1",
      overridePolicy: "HUMAN_EXACT_SUBJECT"
    },
    deterministicSatisfied: true,
    integrityValid: true,
    provenanceValid: true,
    evidenceComplete: true,
    claimSetHash: hashes.claimSetHash,
    subjectRef: "jacket-1",
    subjectHash: hashes.subjectHash,
    evidenceSetHash: hashes.evidenceSetHash,
    attestationHash: hashes.attestationHash,
    attestation: {
      schemaVersion: "semantic-attestation-v1",
      attestationId: "att-1",
      claimId: "waterproof",
      subjectHash: hashes.subjectHash,
      evidenceSetHash: hashes.evidenceSetHash,
      evidenceHashes: ["sha256:evidence-record"],
      result,
      supportQuotes: [],
      contradictionQuotes: [],
      modelId: "test-model",
      attestorVersion: "test-v1",
      promptHash: "sha256:prompt",
      configHash: "sha256:config",
      createdAt: now
    }
  };
}

function overrideFor(claimId) {
  return {
    schemaVersion: "buyer-override-v1",
    overrideId: "override-1",
    claimSetHash: hashes.claimSetHash,
    claimId,
    subjectRef: "jacket-1",
    subjectHash: hashes.subjectHash,
    evidenceSetHash: hashes.evidenceSetHash,
    attestationHash: hashes.attestationHash,
    decision: "ACCEPT_EXCEPTION",
    expiresAt: "2026-10-18T12:05:00.000Z",
    nonce: "nonce-1",
    buyerSignature: { alg: "ES256", keyId: "buyer-key-1", signatureB64: "c2ln" }
  };
}
