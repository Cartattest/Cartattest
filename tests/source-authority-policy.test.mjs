import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSourceAuthority } from "../dist/policy/SourceAuthorityPolicy.js";

const baseManifest = {
  schemaVersion: "evidence-manifest-v1",
  evidenceProfileId: "waterproof-v1",
  requiredSourceClasses: ["MERCHANT_TECHNICAL_SPEC"],
  admissibleSourceClasses: ["MERCHANT_TECHNICAL_SPEC", "CUSTOMER_REVIEW"],
  sourceAuthority: [
    { sourceClass: "MERCHANT_TECHNICAL_SPEC", rank: 90, maySatisfy: true, mayBlockIfContradictory: true },
    { sourceClass: "CUSTOMER_REVIEW", rank: 20, maySatisfy: false, mayBlockIfContradictory: false }
  ],
  freshnessSeconds: 900,
  contradictionPolicy: "STEP_UP_ON_EQUAL_OR_HIGHER_AUTHORITY"
};
const evidence = [
  { evidenceId: "spec", sourceClass: "MERCHANT_TECHNICAL_SPEC" },
  { evidenceId: "review", sourceClass: "CUSTOMER_REVIEW" }
];

test("steps up when lower-authority review support conflicts with a merchant spec", () => {
  assert.equal(evaluateSourceAuthority({
    result: "SUPPORTED",
    supportQuotes: [{ evidenceId: "review", verbatim: "Totally waterproof" }],
    contradictionQuotes: [{ evidenceId: "spec", verbatim: "Not certified waterproof" }]
  }, baseManifest, evidence), "STEP_UP");
});

test("does not let a customer review satisfy a claim", () => {
  assert.equal(evaluateSourceAuthority({
    result: "SUPPORTED",
    supportQuotes: [{ evidenceId: "review", verbatim: "Totally waterproof" }],
    contradictionQuotes: []
  }, baseManifest, evidence), "STEP_UP");
});

test("allows higher-authority technical support over a non-authoritative review", () => {
  assert.equal(evaluateSourceAuthority({
    result: "SUPPORTED",
    supportQuotes: [{ evidenceId: "spec", verbatim: "Waterproof shell" }],
    contradictionQuotes: [{ evidenceId: "review", verbatim: "Not waterproof" }]
  }, baseManifest, evidence), "ALLOW");
});

test("honors block versus step-up policy on equal or higher authority contradiction", () => {
  const attestation = {
    result: "SUPPORTED",
    supportQuotes: [{ evidenceId: "spec", verbatim: "Waterproof shell" }],
    contradictionQuotes: [{ evidenceId: "spec", verbatim: "Not certified waterproof" }]
  };
  assert.equal(evaluateSourceAuthority(attestation, baseManifest, evidence), "STEP_UP");
  assert.equal(evaluateSourceAuthority(attestation, {
    ...baseManifest,
    contradictionPolicy: "BLOCK_EQUAL_OR_HIGHER_AUTHORITY"
  }, evidence), "BLOCK");
});

test("fails closed for unproven output or quotes from unknown evidence", () => {
  assert.equal(evaluateSourceAuthority({ result: "UNPROVEN", supportQuotes: [], contradictionQuotes: [] }, baseManifest, evidence), "STEP_UP");
  assert.equal(evaluateSourceAuthority({
    result: "SUPPORTED",
    supportQuotes: [{ evidenceId: "unknown", verbatim: "Waterproof" }],
    contradictionQuotes: []
  }, baseManifest, evidence), "BLOCK");
});

test("fails closed when the source authority manifest is malformed", () => {
  const duplicateAuthority = {
    ...baseManifest,
    sourceAuthority: [
      ...baseManifest.sourceAuthority,
      { sourceClass: "MERCHANT_TECHNICAL_SPEC", rank: 0, maySatisfy: true, mayBlockIfContradictory: false }
    ]
  };
  assert.equal(evaluateSourceAuthority({
    result: "SUPPORTED",
    supportQuotes: [{ evidenceId: "spec", verbatim: "Waterproof shell" }],
    contradictionQuotes: []
  }, duplicateAuthority, evidence), "BLOCK");
});
