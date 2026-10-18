import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateSelectionAdmission } from "../dist/application/SelectionAdmissionEvaluator.js";
import { hashEvidenceSet } from "../dist/bundle/EvidenceSet.js";
import { FixtureMerchantAdapter } from "../dist/merchant/FixtureMerchantAdapter.js";
import { sha256 } from "../dist/domain/Hash.js";
import canonicalize from "canonicalize";

const catalogue = JSON.parse(await readFile(new URL("../fixtures/merchant/catalogue.json", import.meta.url), "utf8"));
const manifest = {
  schemaVersion: "evidence-manifest-v1",
  evidenceProfileId: "waterproof-v1",
  requiredSourceClasses: ["MERCHANT_TECHNICAL_SPEC"],
  admissibleSourceClasses: ["MERCHANT_STRUCTURED_ATTRIBUTE", "MERCHANT_TECHNICAL_SPEC", "MERCHANT_DESCRIPTION", "MERCHANT_QA", "CUSTOMER_REVIEW"],
  sourceAuthority: [
    { sourceClass: "MERCHANT_STRUCTURED_ATTRIBUTE", rank: 100, maySatisfy: true, mayBlockIfContradictory: true },
    { sourceClass: "MERCHANT_TECHNICAL_SPEC", rank: 90, maySatisfy: true, mayBlockIfContradictory: true },
    { sourceClass: "MERCHANT_DESCRIPTION", rank: 60, maySatisfy: false, mayBlockIfContradictory: false },
    { sourceClass: "MERCHANT_QA", rank: 40, maySatisfy: false, mayBlockIfContradictory: false },
    { sourceClass: "CUSTOMER_REVIEW", rank: 20, maySatisfy: false, mayBlockIfContradictory: false }
  ],
  freshnessSeconds: 900,
  contradictionPolicy: "STEP_UP_ON_EQUAL_OR_HIGHER_AUTHORITY"
};
const attestorConfig = {
  provider: "fixture",
  modelId: "fixture-model-v1",
  temperature: 0,
  topP: 1,
  maxOutputTokens: 100,
  promptHash: `sha256:${"1".repeat(64)}`,
  configHash: `sha256:${"2".repeat(64)}`,
  attestorVersion: "test-v1"
};
const now = "2026-10-18T12:00:00.000Z";

test("allows a supported claim grounded in authoritative technical evidence", async () => {
  const result = await evaluate("jacket-waterproof-02", "black-m", () => "SUPPORTED", true);
  assert.deepEqual(result.outcome, { status: "ALLOW" });
  assert.equal(result.resolvedSelection.subjectRef, "jacket-waterproof-02");
});

test("steps up when review support conflicts with technical evidence", async () => {
  const result = await evaluate("jacket-water-resistant-01", "blue-m", () => "SUPPORTED", true);
  assert.deepEqual(result.outcome, { status: "STEP_UP", claimIds: ["waterproof"] });
});

test("does not invoke the attestor when required evidence is missing", async () => {
  let attestorCalled = false;
  const result = await evaluate("jacket-waterproof-02", "black-m", () => {
    attestorCalled = true;
    return "SUPPORTED";
  }, false);
  assert.equal(attestorCalled, false);
  assert.deepEqual(result.outcome, { status: "STEP_UP", claimIds: ["waterproof"] });
});

test("rejects an unverified Claim Set before resolving a merchant selection", async () => {
  let merchantCalled = false;
  const result = await evaluateSelectionAdmission(request("jacket-waterproof-02", "black-m"), {
    ...dependencies(),
    verifyBuyerSignature: async () => false,
    merchant: { async resolveSelection() { merchantCalled = true; throw new Error("should not resolve"); }, async fetchEvidence() { return []; } }
  });
  assert.equal(merchantCalled, false);
  assert.deepEqual(result.outcome, { status: "BLOCK", reason: "CLAIM_SET_SIGNATURE_INVALID" });
});

test("blocks evidence records attributed to a different subject", async () => {
  const merchant = new FixtureMerchantAdapter(catalogue, () => new Date(now));
  const fetchEvidence = merchant.fetchEvidence.bind(merchant);
  merchant.fetchEvidence = async (args) => (await fetchEvidence(args)).map((item) => ({ ...item, subjectRef: "another-jacket" }));
  const result = await evaluateSelectionAdmission(request("jacket-waterproof-02", "black-m"), {
    ...dependencies(),
    merchant
  });
  assert.deepEqual(result.outcome, { status: "BLOCK", reason: "PROVENANCE_FAILURE" });
});

async function evaluate(subjectRef, variantRef, outcome, completeEvidence) {
  let attestorCalled = false;
  const merchant = new FixtureMerchantAdapter(catalogue, () => new Date(now));
  const originalFetch = merchant.fetchEvidence.bind(merchant);
  merchant.fetchEvidence = async (args) => {
    const evidence = await originalFetch(args);
    return completeEvidence ? evidence : evidence.filter((item) => item.sourceClass !== "MERCHANT_TECHNICAL_SPEC");
  };
  const result = await evaluateSelectionAdmission(request(subjectRef, variantRef), {
    ...dependencies(),
    merchant,
    attestor: {
      async attest(args) {
        attestorCalled = true;
        return makeAttestation(args, outcome());
      }
    }
  });
  if (completeEvidence) assert.equal(attestorCalled, true);
  return result;
}

function dependencies() {
  const claimSet = {
    schemaVersion: "claim-set-v1",
    claimSetId: "claim-set-1",
    buyerRequestText: "Find a waterproof jacket.",
    claims: [{ claimId: "waterproof", kind: "SEMANTIC_BOOLEAN", humanText: "Waterproof", operator: "SUPPORTED", value: true, evidenceProfileId: "waterproof-v1", overridePolicy: "HUMAN_EXACT_SUBJECT" }],
    createdAt: "2026-10-18T11:55:00.000Z",
    expiresAt: "2026-10-18T12:15:00.000Z",
    buyerSignature: { alg: "ES256", keyId: "buyer-1", signatureB64: "signature" }
  };
  return {
    async loadClaimSet() { return { claimSet, claimSetHash: await sha256(canonicalize(claimSet)) }; },
    async verifyBuyerSignature() { return true; },
    merchant: new FixtureMerchantAdapter(catalogue, () => new Date(now)),
    getManifest() { return manifest; },
    getAttestorConfig() { return attestorConfig; },
    attestor: { async attest(args) { return makeAttestation(args, "SUPPORTED"); } },
    now: () => new Date(now),
    newId: () => "session-1"
  };
}

function request(subjectRef, variantRef) {
  return { claimSetId: "claim-set-1", subjectRef, variantRef, quantity: 1, fulfillmentRef: "ie-standard" };
}

async function makeAttestation(args, result) {
  const lines = args.evidence;
  const support = lines.find((item) => item.sourceClass === "MERCHANT_TECHNICAL_SPEC") ?? lines[0];
  const review = lines.find((item) => item.sourceClass === "CUSTOMER_REVIEW");
  const contradiction = lines.find((item) => item.sourceClass === "MERCHANT_TECHNICAL_SPEC");
  return {
    schemaVersion: "semantic-attestation-v1",
    attestationId: "attestation-1",
    claimId: args.claim.claimId,
    subjectHash: args.subjectHash,
    evidenceSetHash: await evidenceHash(lines),
    evidenceHashes: [...new Set(lines.flatMap((item) => [item.rawHash, item.modelViewHash]))],
    result,
    supportQuotes: result === "SUPPORTED" ? [{ evidenceId: review && contradiction ? review.evidenceId : support.evidenceId, verbatim: review && contradiction ? review.modelView : support.modelView }] : [],
    contradictionQuotes: review && contradiction ? [{ evidenceId: contradiction.evidenceId, verbatim: contradiction.modelView }] : [],
    modelId: args.config.modelId,
    attestorVersion: args.config.attestorVersion,
    promptHash: args.config.promptHash,
    configHash: args.config.configHash,
    createdAt: now
  };
}

async function evidenceHash(evidence) {
  return hashEvidenceSet(evidence);
}
