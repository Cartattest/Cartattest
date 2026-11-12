// Demo shopping agent. Plays the agent's part against a running CartAttest server:
// the buyer signs "waterproof jacket under GBP 100", then the agent proposes each catalogue jacket.
// The agent only proposes identifiers; CartAttest (with the Gemini attestor) decides.
//   pnpm demo:agent                 -> tries all three jackets
//   pnpm demo:agent jacket-waterproof-02   -> tries one
import { readFile } from "node:fs/promises";
import { createPrivateKey } from "node:crypto";
import canonicalize from "canonicalize";

const baseUrl = new URL(process.env.CARTATTEST_BASE_URL || "http://127.0.0.1:3000");
if (!["127.0.0.1", "localhost"].includes(baseUrl.hostname)) throw new Error("DEMO_AGENT_REQUIRES_LOCAL_SERVER");
const privatePem = await readFile(process.env.CARTATTEST_BUYER_PRIVATE_KEY_PATH || ".codex/keys/buyer.private.pem", "utf8");
const privateKey = await crypto.subtle.importKey("pkcs8", createPrivateKey(privatePem).export({ type: "pkcs8", format: "der" }),
  { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

const catalogue = JSON.parse(await readFile(new URL("../fixtures/merchant/catalogue.json", import.meta.url), "utf8"));
const wanted = process.argv.slice(2);
const products = catalogue.products.filter((product) => wanted.length === 0 || wanted.includes(product.subjectRef));
if (products.length === 0) throw new Error("UNKNOWN_PRODUCT");

const createdAt = new Date();
const claimSet = {
  schemaVersion: "claim-set-v1",
  claimSetId: `demo-${crypto.randomUUID()}`,
  buyerRequestText: "Buy me a waterproof jacket, size M, under GBP 100.",
  claims: [
    { claimId: "budget", kind: "BUDGET_MAX", humanText: "Total price must be no more than GBP 100.",
      operator: "LTE", value: 100, currency: "GBP", overridePolicy: "NEVER" },
    { claimId: "waterproof", kind: "SEMANTIC_BOOLEAN", humanText: "The jacket must be waterproof, not just water-resistant.",
      operator: "SUPPORTED", value: true, evidenceProfileId: "waterproof-v1", overridePolicy: "HUMAN_EXACT_SUBJECT" }
  ],
  createdAt: createdAt.toISOString(),
  expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString()
};
const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey,
  new TextEncoder().encode(canonicalize(claimSet))));
const signed = { ...claimSet, buyerSignature: { alg: "ES256", keyId: process.env.CARTATTEST_BUYER_KEY_ID || "buyer-local-v1",
  signatureB64: Buffer.from(signature).toString("base64") } };
if ((await call("/api/claim-sets", "POST", signed)).status !== "STORED") throw new Error("CLAIM_SET_NOT_STORED");

process.stdout.write(`Buyer signed: "${claimSet.buyerRequestText}"\n\n`);
for (const product of products) {
  const variant = product.variants[0];
  process.stdout.write(`Agent proposes: ${product.name} (${variant.currency} ${variant.unitAmount})\n`);
  const result = await call("/api/selections", "POST", { claimSetId: claimSet.claimSetId, subjectRef: product.subjectRef,
    variantRef: variant.variantRef, quantity: 1, fulfillmentRef: catalogue.fulfillments[0].fulfillmentRef });
  for (const check of result.evidenceChecks ?? []) {
    process.stdout.write(`  AI evidence check (${check.modelId}): ${check.result}\n`);
    for (const q of check.supportQuotes) process.stdout.write(`    supports:    "${q.verbatim}" [${q.sourceClass}]\n`);
    for (const q of check.contradictionQuotes) process.stdout.write(`    contradicts: "${q.verbatim}" [${q.sourceClass}]\n`);
  }
  if (!result.evidenceChecks?.length) process.stdout.write("  AI evidence check: none recorded (attestor disabled, unavailable or failed closed)\n");
  if (result.status === "ALLOWED") {
    process.stdout.write(`  CartAttest: ALLOWED -> PayPal order created. Approve here:\n  ${new URL(result.approvalUrl, baseUrl)}\n\n`);
  } else if (result.status === "STEP_UP") {
    process.stdout.write(`  CartAttest: STEP-UP -> evidence does not prove the requirement; buyer must decide:\n  ${new URL(result.decisionUrl, baseUrl)}\n\n`);
  } else {
    process.stdout.write(`  CartAttest: ${result.status}${result.reason ? ` (${result.reason})` : ""} -> no PayPal order\n\n`);
  }
}

async function call(path, method = "GET", body) {
  const response = await fetch(new URL(path, baseUrl), { method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP_${response.status}_${value.error || "FAILED"}`);
  return value;
}
