import assert from "node:assert/strict";
import test from "node:test";
import { assessEvidenceManifest } from "../dist/policy/EvidenceManifestPolicy.js";

const now = "2026-10-18T12:00:00.000Z";
const manifest = {
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

test("marks a complete, admissible, fresh required source set complete", () => {
  assert.deepEqual(assessEvidenceManifest([evidence("spec", "MERCHANT_TECHNICAL_SPEC", now)], manifest, now), {
    complete: true,
    missingRequiredSourceClasses: [],
    staleEvidenceIds: [],
    inadmissibleEvidenceIds: []
  });
});

test("treats evidence at the freshness boundary as fresh", () => {
  assert.deepEqual(assessEvidenceManifest([evidence("spec", "MERCHANT_TECHNICAL_SPEC", "2026-10-18T11:45:00.000Z")], manifest, now), {
    complete: true,
    missingRequiredSourceClasses: [],
    staleEvidenceIds: [],
    inadmissibleEvidenceIds: []
  });
});

test("missing a required source class is incomplete", () => {
  assert.deepEqual(assessEvidenceManifest([], manifest, now), {
    complete: false,
    missingRequiredSourceClasses: ["MERCHANT_TECHNICAL_SPEC"],
    staleEvidenceIds: [],
    inadmissibleEvidenceIds: []
  });
});

test("marks stale evidence as incomplete even when the required class is present", () => {
  assert.deepEqual(assessEvidenceManifest([evidence("spec", "MERCHANT_TECHNICAL_SPEC", "2026-10-18T11:44:59.000Z")], manifest, now), {
    complete: false,
    missingRequiredSourceClasses: [],
    staleEvidenceIds: ["spec"],
    inadmissibleEvidenceIds: []
  });
});

test("fails closed on evidence timestamps later than the evaluation time", () => {
  assert.deepEqual(assessEvidenceManifest([evidence("spec", "MERCHANT_TECHNICAL_SPEC", "2026-10-18T12:00:01.000Z")], manifest, now), {
    complete: false,
    missingRequiredSourceClasses: [],
    staleEvidenceIds: ["spec"],
    inadmissibleEvidenceIds: []
  });
});

test("marks evidence outside the manifest's admissible sources as incomplete", () => {
  assert.deepEqual(assessEvidenceManifest([evidence("review", "AGENT_GENERATED_SUMMARY", now)], manifest, now), {
    complete: false,
    missingRequiredSourceClasses: ["MERCHANT_TECHNICAL_SPEC"],
    staleEvidenceIds: [],
    inadmissibleEvidenceIds: ["review"]
  });
});

test("rejects a manifest that requires a source class it does not admit", () => {
  assert.throws(() => assessEvidenceManifest([], {
    ...manifest,
    admissibleSourceClasses: ["CUSTOMER_REVIEW"]
  }, now), { message: "INVALID_EVIDENCE_MANIFEST" });
});

function evidence(evidenceId, sourceClass, retrievedAt) {
  return {
    schemaVersion: "merchant-evidence-v1",
    evidenceId,
    subjectRef: "jacket-1",
    sourceClass,
    origin: "fixture://merchant/products/jacket-1",
    fieldLocator: "spec.shell",
    retrievedAt,
    rawContent: "fixture evidence",
    rawHash: "sha256:raw",
    modelView: "fixture evidence",
    modelViewHash: "sha256:view"
  };
}
