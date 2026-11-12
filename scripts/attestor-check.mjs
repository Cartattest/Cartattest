// Checks the Gemini key and model before a demo, without PostgreSQL or PayPal.
//   pnpm attestor:check            -> lists models this key can call
//   ATTESTOR_MODEL_ID=... pnpm attestor:check -> also attests "waterproof" for every demo product
import { readFile } from "node:fs/promises";
import { FixtureMerchantAdapter } from "../dist/merchant/FixtureMerchantAdapter.js";
import { GeminiSemanticAttestor, GEMINI_DEFAULT_ENDPOINT, createGeminiAttestorConfig, answeredModel } from "../dist/attestor/GeminiSemanticAttestor.js";
import { validateSemanticAttestation } from "../dist/attestor/AttestationValidation.js";
import { evaluateSourceAuthority } from "../dist/policy/SourceAuthorityPolicy.js";
import { hashEvidenceSet } from "../dist/bundle/EvidenceSet.js";

const apiKey = process.env.ATTESTOR_API_KEY;
if (!apiKey) throw new Error("ATTESTOR_API_KEY_REQUIRED: put your Gemini API key in .env");

const listed = await fetch(`${GEMINI_DEFAULT_ENDPOINT}/models?pageSize=1000`, { headers: { "x-goog-api-key": apiKey } });
if (!listed.ok) throw new Error(`GEMINI_KEY_CHECK_FAILED_HTTP_${listed.status}: ${(await listed.text()).slice(0, 300)}`);
const models = ((await listed.json()).models ?? [])
  .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
  .map((model) => String(model.name).replace(/^models\//, ""));
process.stdout.write(`Key OK. Models this key can call with generateContent:\n  ${models.join("\n  ")}\n\n`);

const modelId = process.env.ATTESTOR_MODEL_ID;
if (!modelId) {
  process.stdout.write("Set ATTESTOR_MODEL_ID in .env to one of the models above (a current 'flash' model is a good default), then run again.\n");
  process.exit(0);
}

const catalogue = JSON.parse(await readFile(new URL("../fixtures/merchant/catalogue.json", import.meta.url), "utf8"));
const raw = JSON.parse(await readFile(new URL("../fixtures/merchant/evidence-manifests.json", import.meta.url), "utf8")).profiles[0];
const manifest = {
  schemaVersion: raw.schema_version, evidenceProfileId: raw.evidence_profile_id,
  requiredSourceClasses: raw.required_source_classes, admissibleSourceClasses: raw.admissible_source_classes,
  sourceAuthority: raw.source_authority.map((rule) => ({ sourceClass: rule.source_class, rank: rule.rank,
    maySatisfy: rule.may_satisfy, mayBlockIfContradictory: rule.may_block_if_contradictory })),
  freshnessSeconds: raw.freshness_seconds, contradictionPolicy: raw.contradiction_policy
};
const merchant = new FixtureMerchantAdapter(catalogue);
const modelIds = [modelId, ...(process.env.ATTESTOR_FALLBACK_MODEL_ID || "").split(",").map((id) => id.trim()).filter(Boolean)];
const config = await createGeminiAttestorConfig(modelIds, Number(process.env.ATTESTOR_MAX_OUTPUT_TOKENS || "4096"));
const attestor = new GeminiSemanticAttestor({ apiKey, modelIds });
process.stdout.write(`Model order: ${modelIds.join(" -> ")} (each retried with backoff on 429/5xx)\n\n`);
const claim = { claimId: "waterproof", kind: "SEMANTIC_BOOLEAN", humanText: "The jacket must be waterproof, not just water-resistant.",
  operator: "SUPPORTED", value: true, evidenceProfileId: manifest.evidenceProfileId, overridePolicy: "HUMAN_EXACT_SUBJECT" };

let failures = 0;
for (const product of catalogue.products) {
  const variant = product.variants[0];
  const resolved = await merchant.resolveSelection({ claimSetId: "attestor-check", subjectRef: product.subjectRef,
    variantRef: variant.variantRef, quantity: 1, fulfillmentRef: catalogue.fulfillments[0].fulfillmentRef });
  const evidence = await merchant.fetchEvidence({ subjectRef: product.subjectRef, manifest, sessionId: crypto.randomUUID() });
  const started = Date.now();
  let line;
  try {
    const attestation = await attestor.attest({ claimSetHash: `sha256:${"0".repeat(64)}`, claim, subjectHash: resolved.subjectHash,
      manifest, evidence, config });
    const valid = validateSemanticAttestation(attestation, { claimId: claim.claimId, subjectHash: resolved.subjectHash,
      evidenceSetHash: await hashEvidenceSet(evidence), evidence, config });
    const policy = evaluateSourceAuthority(valid, manifest, evidence);
    const quote = (q) => `    "${q.verbatim}" (${evidence.find((e) => e.evidenceId === q.evidenceId)?.sourceClass})`;
    line = `${product.name}: ${answeredModel(valid.attestationId)} says ${valid.result}; source-authority policy -> ${policy} (${Date.now() - started} ms)\n` +
      (valid.supportQuotes.length ? `  supports:\n${valid.supportQuotes.map(quote).join("\n")}\n` : "") +
      (valid.contradictionQuotes.length ? `  contradicts:\n${valid.contradictionQuotes.map(quote).join("\n")}\n` : "");
  } catch (error) {
    failures += 1;
    line = `${product.name}: FAILED CLOSED (${error instanceof Error ? error.message : "error"}) - would be treated as UNPROVEN\n`;
  }
  process.stdout.write(line + "\n");
}
process.stdout.write(failures ? `${failures} product(s) failed closed; see messages above.\n` : "ATTESTOR_CHECK_PASS\n");
