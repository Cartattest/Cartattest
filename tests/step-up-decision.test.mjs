import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStepUpDecision } from "../dist/application/StepUpDecisionService.js";

const hash = (digit) => `sha256:${digit.repeat(64)}`;
const evaluation = {
  claim: { claimId: "waterproof", kind: "SEMANTIC_BOOLEAN", humanText: "Waterproof", operator: "SUPPORTED", value: true,
    evidenceProfileId: "waterproof-v1", overridePolicy: "HUMAN_EXACT_SUBJECT" },
  integrityValid: true, provenanceValid: true, evidenceComplete: true, claimSetHash: hash("1"), subjectRef: "jacket-1",
  subjectHash: hash("2"), evidenceSetHash: hash("3"), attestationHash: hash("4"),
  evidenceManifest: { schemaVersion: "evidence-manifest-v1", evidenceProfileId: "waterproof-v1", requiredSourceClasses: [],
    admissibleSourceClasses: ["MERCHANT_TECHNICAL_SPEC"], sourceAuthority: [
      { sourceClass: "MERCHANT_TECHNICAL_SPEC", rank: 90, maySatisfy: true, mayBlockIfContradictory: true }
    ], freshnessSeconds: 900, contradictionPolicy: "STEP_UP_ON_EQUAL_OR_HIGHER_AUTHORITY" },
  evidence: [{ evidenceId: "spec", sourceClass: "MERCHANT_TECHNICAL_SPEC" }],
  attestation: { schemaVersion: "semantic-attestation-v1", attestationId: "att-1", claimId: "waterproof", subjectHash: hash("2"),
    evidenceSetHash: hash("3"), evidenceHashes: [hash("5")], result: "CONTRADICTED", supportQuotes: [],
    contradictionQuotes: [], modelId: "fixture", attestorVersion: "v1", promptHash: hash("6"), configHash: hash("7"),
    createdAt: "2026-10-18T11:59:00.000Z" }
};
const context = {
  schemaVersion: "step-up-context-v1", claimIds: ["waterproof"], claimEvaluations: [evaluation],
  claimSet: {}, claimSetHash: hash("1"), resolvedSelection: {},
  admissionEvidence: { evidenceManifestVersion: "waterproof-v1", evidenceSetHashes: [hash("3")], attestationHashes: [hash("4")], overrideHashes: [] }
};
const override = {
  schemaVersion: "buyer-override-v1", overrideId: "override-1", claimSetHash: hash("1"), claimId: "waterproof",
  subjectRef: "jacket-1", subjectHash: hash("2"), evidenceSetHash: hash("3"), attestationHash: hash("4"),
  decision: "ACCEPT_EXCEPTION", expiresAt: "2026-10-18T12:10:00.000Z", nonce: "nonce-1",
  buyerSignature: { alg: "ES256", keyId: "buyer-1", signatureB64: "signature" }
};

test("re-evaluates the frozen STEP-UP context with a valid scoped override", async () => {
  const result = await evaluateStepUpDecision(context, [override], { now: "2026-10-18T12:00:00.000Z", verifyOverride: () => true });
  assert.deepEqual(result.outcome, { status: "ALLOW" });
  assert.equal(result.claimEvaluations[0].override, override);
  assert.deepEqual(context.claimEvaluations[0].override, undefined);
  assert.equal(result.admissionEvidence.overrideHashes.length, 1);
  assert.match(result.admissionEvidence.overrideHashes[0], /^sha256:[0-9a-f]{64}$/);
});
