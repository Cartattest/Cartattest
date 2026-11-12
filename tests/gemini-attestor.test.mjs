import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GeminiSemanticAttestor, GEMINI_SYSTEM_PROMPT, createGeminiAttestorConfig, parseModelOutput } from "../dist/attestor/GeminiSemanticAttestor.js";
import { CachedSemanticAttestor } from "../dist/attestor/CachedSemanticAttestor.js";
import { validateSemanticAttestation } from "../dist/attestor/AttestationValidation.js";
import { evaluateSelectionAdmission } from "../dist/application/SelectionAdmissionEvaluator.js";
import { FixtureMerchantAdapter } from "../dist/merchant/FixtureMerchantAdapter.js";
import { hashEvidenceSet } from "../dist/bundle/EvidenceSet.js";
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
const claim = { claimId: "waterproof", kind: "SEMANTIC_BOOLEAN", humanText: "The jacket must be waterproof.",
  operator: "SUPPORTED", value: true, evidenceProfileId: "waterproof-v1", overridePolicy: "HUMAN_EXACT_SUBJECT" };
const apiKey = "test-key-0123456789"; // gitleaks:allow (fake key used only by the fake fetch below)

async function evidenceFor(subjectRef) {
  const merchant = new FixtureMerchantAdapter(catalogue);
  const product = catalogue.products.find((item) => item.subjectRef === subjectRef);
  const resolved = await merchant.resolveSelection({ claimSetId: "c", subjectRef, variantRef: product.variants[0].variantRef,
    quantity: 1, fulfillmentRef: "ie-standard" });
  const evidence = await merchant.fetchEvidence({ subjectRef, manifest, sessionId: "s" });
  return { resolved, evidence };
}

function fakeGemini(answer, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const status = typeof answer === "number" ? answer : 200;
    const text = typeof answer === "function" ? answer(JSON.parse(init.body)) : JSON.stringify(answer);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status,
      headers: { "content-type": "application/json" } });
  };
}

test("Gemini attestor returns an attestation that passes CartAttest validation", async () => {
  const { resolved, evidence } = await evidenceFor("jacket-waterproof-02");
  const spec = evidence.find((item) => item.sourceClass === "MERCHANT_TECHNICAL_SPEC");
  const calls = [];
  const config = await createGeminiAttestorConfig("gemini-test-model");
  const attestor = new GeminiSemanticAttestor({ apiKey, modelId: "gemini-test-model", fetch: fakeGemini({ result: "SUPPORTED",
    supportQuotes: [{ evidenceId: spec.evidenceId, verbatim: "Waterproof and seam-sealed shell" }], contradictionQuotes: [] }, calls) });
  const attestation = await attestor.attest({ claimSetHash: `sha256:${"0".repeat(64)}`, claim, subjectHash: resolved.subjectHash,
    manifest, evidence, config });
  const valid = validateSemanticAttestation(attestation, { claimId: "waterproof", subjectHash: resolved.subjectHash,
    evidenceSetHash: await hashEvidenceSet(evidence), evidence, config });
  assert.equal(valid.result, "SUPPORTED");
  assert.equal(valid.modelId, "gemini-test-model");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/models\/gemini-test-model:generateContent$/);
  assert.ok(!calls[0].url.includes(apiKey), "API key must not appear in the URL");
  assert.equal(calls[0].init.headers["x-goog-api-key"], apiKey);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.systemInstruction.parts[0].text, GEMINI_SYSTEM_PROMPT);
  assert.equal(body.generationConfig.temperature, 0);
  assert.match(body.contents[0].parts[0].text, /untrusted data/);
  assert.equal(config.promptHash, await sha256(GEMINI_SYSTEM_PROMPT));
});

test("a paraphrased quote fails closed as UNPROVEN through the cached attestor", async () => {
  const { resolved, evidence } = await evidenceFor("jacket-water-resistant-01");
  const review = evidence.find((item) => item.sourceClass === "CUSTOMER_REVIEW");
  const config = await createGeminiAttestorConfig("gemini-test-model");
  const attestor = new CachedSemanticAttestor(new GeminiSemanticAttestor({ apiKey, modelId: "gemini-test-model",
    fetch: fakeGemini({ result: "SUPPORTED", supportQuotes: [{ evidenceId: review.evidenceId, verbatim: "The jacket is fully waterproof" }] }) }));
  const attestation = await attestor.attest({ claimSetHash: `sha256:${"0".repeat(64)}`, claim, subjectHash: resolved.subjectHash,
    manifest, evidence, config });
  assert.equal(attestation.result, "UNPROVEN");
  assert.deepEqual(attestation.supportQuotes, []);
});

test("transport and output failures throw so admission treats the claim as unproven", async () => {
  const { resolved, evidence } = await evidenceFor("jacket-waterproof-02");
  const config = await createGeminiAttestorConfig("gemini-test-model");
  const args = { claimSetHash: `sha256:${"0".repeat(64)}`, claim, subjectHash: resolved.subjectHash, manifest, evidence, config };
  await assert.rejects(new GeminiSemanticAttestor({ apiKey, modelId: "gemini-test-model", fetch: fakeGemini(400) }).attest(args), /ATTESTOR_HTTP_400/);
  await assert.rejects(new GeminiSemanticAttestor({ apiKey, modelId: "gemini-test-model", fetch: fakeGemini(() => "not json") }).attest(args),
    /ATTESTOR_OUTPUT_NOT_JSON/);
  const calls = [];
  await assert.rejects(new GeminiSemanticAttestor({ apiKey, modelId: "gemini-test-model", fetch: fakeGemini(503, calls) }).attest(args),
    /ATTESTOR_HTTP_503/);
  assert.equal(calls.length, 2, "one retry on a server error");
  await assert.rejects(new GeminiSemanticAttestor({ apiKey, modelId: "other-model", fetch: fakeGemini(400) }).attest(args), /ATTESTOR_CONFIG_MISMATCH/);
});

test("model output parser accepts fenced JSON and rejects unknown results", () => {
  assert.equal(parseModelOutput("```json\n{\"result\":\"UNPROVEN\"}\n```").result, "UNPROVEN");
  assert.throws(() => parseModelOutput("{\"result\":\"ALLOW\"}"), /ATTESTOR_OUTPUT_INVALID/);
});

test("F3 regression: with a real advancing clock, fresh evidence reaches the attestor and a supported claim is allowed", async () => {
  let tick = Date.now();
  const clock = () => new Date(tick += 5);
  const merchant = new FixtureMerchantAdapter(catalogue, clock);
  const createdAt = new Date(Date.now() - 1000);
  const claimSet = { schemaVersion: "claim-set-v1", claimSetId: "f3", buyerRequestText: "Waterproof jacket",
    claims: [claim], createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
    buyerSignature: { alg: "ES256", keyId: "k", signatureB64: "AA==" } };
  const claimSetHash = await sha256(canonicalize(claimSet));
  let called = 0;
  const config = await createGeminiAttestorConfig("gemini-test-model");
  const gemini = new GeminiSemanticAttestor({ apiKey, modelId: "gemini-test-model", now: clock, fetch: fakeGemini((body) => {
    called += 1;
    const request = JSON.parse(body.contents[0].parts[0].text.split("<request>")[1].split("</request>")[0]);
    const spec = request.evidence.find((item) => item.sourceClass === "MERCHANT_TECHNICAL_SPEC");
    return JSON.stringify({ result: "SUPPORTED", supportQuotes: [{ evidenceId: spec.evidenceId, verbatim: "Waterproof and seam-sealed shell" }],
      contradictionQuotes: [] });
  }) });
  const result = await evaluateSelectionAdmission({ claimSetId: "f3", subjectRef: "jacket-waterproof-02", variantRef: "black-m",
    quantity: 1, fulfillmentRef: "ie-standard" }, {
    loadClaimSet: async () => ({ claimSet, claimSetHash }),
    verifyBuyerSignature: async () => true,
    merchant,
    getManifest: () => manifest,
    getAttestorConfig: () => config,
    attestor: new CachedSemanticAttestor(gemini, clock),
    now: clock,
    newId: () => crypto.randomUUID()
  });
  assert.equal(called, 1, "attestor must be called");
  assert.deepEqual(result.outcome, { status: "ALLOW" });
});
