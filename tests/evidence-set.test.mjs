import assert from "node:assert/strict";
import test from "node:test";
import { hashEvidenceSet } from "../dist/bundle/EvidenceSet.js";
import { sha256 } from "../dist/domain/Hash.js";

test("hashes evidence as an order-independent set", async () => {
  const first = await evidence("e-1", "spec", "MERCHANT_TECHNICAL_SPEC");
  const second = await evidence("e-2", "review", "CUSTOMER_REVIEW");

  assert.equal(await hashEvidenceSet([first, second]), await hashEvidenceSet([second, first]));
});

test("binds evidence content and provenance into the evidence-set hash", async () => {
  const first = await evidence("e-1", "spec", "MERCHANT_TECHNICAL_SPEC");
  const changedOrigin = { ...first, origin: "fixture://merchant/changed" };
  const changedContent = await evidence("e-1", "different spec", "MERCHANT_TECHNICAL_SPEC");

  assert.notEqual(await hashEvidenceSet([first]), await hashEvidenceSet([changedOrigin]));
  assert.notEqual(await hashEvidenceSet([first]), await hashEvidenceSet([changedContent]));
});

test("rejects tampered content, invalid hashes and duplicate evidence IDs", async () => {
  const item = await evidence("e-1", "spec", "MERCHANT_TECHNICAL_SPEC");
  await assert.rejects(hashEvidenceSet([{ ...item, rawContent: "tampered" }]), { message: "EVIDENCE_INTEGRITY_FAILURE" });
  await assert.rejects(hashEvidenceSet([{ ...item, modelViewHash: "sha256:invalid" }]), { message: "EVIDENCE_INTEGRITY_FAILURE" });
  await assert.rejects(hashEvidenceSet([item, item]), { message: "DUPLICATE_EVIDENCE_ID" });
});

async function evidence(evidenceId, content, sourceClass) {
  return {
    schemaVersion: "merchant-evidence-v1",
    evidenceId,
    subjectRef: "jacket-1",
    sourceClass,
    origin: "fixture://merchant/products/jacket-1",
    fieldLocator: "spec.shell",
    retrievedAt: "2026-10-18T12:00:00.000Z",
    rawContent: content,
    rawHash: await sha256(content),
    modelView: content,
    modelViewHash: await sha256(content)
  };
}
