import { readFile } from "node:fs/promises";
import { createPrivateKey } from "node:crypto";
import canonicalize from "canonicalize";

const baseUrl = new URL(process.env.CARTATTEST_BASE_URL || "http://127.0.0.1:3000");
if (baseUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(baseUrl.hostname)) {
  throw new Error("REPLAY_E2E_REQUIRES_LOCAL_HTTP_SERVER");
}
const keyPath = process.env.CARTATTEST_BUYER_PRIVATE_KEY_PATH || ".codex/keys/buyer.private.pem";
const buyerKeyId = process.env.CARTATTEST_BUYER_KEY_ID || "buyer-local-v1";
const privatePem = await readFile(keyPath, "utf8");
const privateDer = createPrivateKey(privatePem).export({ type: "pkcs8", format: "der" });
const privateKey = await crypto.subtle.importKey("pkcs8", privateDer, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const createdAt = new Date();
const claimSet = {
  schemaVersion: "claim-set-v1",
  claimSetId: `replay-${crypto.randomUUID()}`,
  buyerRequestText: "Find a demo jacket under GBP 100.",
  claims: [{ claimId: "budget", kind: "BUDGET_MAX", humanText: "Total price must be no more than GBP 100.",
    operator: "LTE", value: 100, currency: "GBP", overridePolicy: "NEVER" }],
  createdAt: createdAt.toISOString(),
  expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString()
};
const signingPayload = canonicalize(claimSet);
const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey,
  new TextEncoder().encode(signingPayload)));
const signedClaimSet = { ...claimSet, buyerSignature: {
  alg: "ES256", keyId: buyerKeyId, signatureB64: Buffer.from(signature).toString("base64")
} };

const stored = await json("/api/claim-sets", "POST", signedClaimSet);
if (stored.status !== "STORED") throw new Error("REPLAY_E2E_CLAIM_SET_FAILED");
const checkout = await json("/api/selections", "POST", {
  claimSetId: claimSet.claimSetId,
  subjectRef: "jacket-waterproof-02",
  variantRef: "black-m",
  quantity: 1,
  fulfillmentRef: "ie-standard"
});
if (checkout.status !== "ALLOWED") throw new Error("REPLAY_E2E_SELECTION_" + (checkout.reason || checkout.status));

const approvalUrl = new URL(checkout.approvalUrl, baseUrl);
const approvalPage = await fetch(approvalUrl);
if (!approvalPage.ok || !(await approvalPage.text()).includes("Simulated replay approval")) throw new Error("REPLAY_E2E_APPROVAL_PAGE_FAILED");
await json(`/api/replay/orders/${encodeURIComponent(approvalUrl.searchParams.get("token"))}/approve`, "POST");

const returned = await fetch(new URL(`/checkout/return?token=${encodeURIComponent(approvalUrl.searchParams.get("token"))}`, baseUrl), {
  headers: { accept: "text/html" }, redirect: "manual"
});
if (returned.status !== 303 || !returned.headers.get("location")?.startsWith("/receipt/")) {
  throw new Error(`REPLAY_E2E_RECEIPT_REDIRECT_FAILED_${returned.status}_${returned.headers.get("content-type") || "NO_CONTENT_TYPE"}`);
}
const receiptUrl = returned.headers.get("location");
const receiptPage = await fetch(new URL(receiptUrl, baseUrl));
if (!receiptPage.ok || !(await receiptPage.text()).includes("Verified purchase record")) throw new Error("REPLAY_E2E_RECEIPT_PAGE_FAILED");
const receipt = await json(receiptUrl.replace("/receipt/", "/api/receipts/"));
if (receipt.verified !== true || receipt.capture.status !== "COMPLETED" || receipt.admission.outcome !== "ALLOW") {
  throw new Error("REPLAY_E2E_RECEIPT_CONTENT_INVALID");
}
process.stdout.write(`REPLAY_E2E_PASS admission=${checkout.admissionId} receipt=${receipt.bundleId}\n`);

async function json(path, method = "GET", body) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`REPLAY_E2E_HTTP_${response.status}_${value.error || "FAILED"}`);
  return value;
}
