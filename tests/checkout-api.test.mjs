import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import canonicalize from "canonicalize";
import test from "node:test";
import { handleCheckoutApiRequest } from "../dist/api/CheckoutApi.js";
import { sha256 } from "../dist/domain/Hash.js";
import { hashCartBinding } from "../dist/binding/CartBindingV1.js";
import { createEvidenceBundle } from "../dist/bundle/EvidenceBundle.js";

const claimSet = {
  schemaVersion: "claim-set-v1", claimSetId: "claim-set-1", buyerRequestText: "Waterproof jacket under GBP 100",
  claims: [{ claimId: "waterproof", kind: "SEMANTIC_BOOLEAN", humanText: "Waterproof", operator: "SUPPORTED",
    value: true, evidenceProfileId: "waterproof-v1", overridePolicy: "HUMAN_EXACT_SUBJECT" }],
  createdAt: "2026-10-18T12:00:00.000Z", expiresAt: "2026-10-18T12:15:00.000Z"
};
const claimSetHash = await sha256(canonicalize(claimSet));

test("stores a validated Claim Set through the public API", async () => {
  const calls = [];
  const response = await handleCheckoutApiRequest(post("/api/claim-sets", claimSet), dependencies(fakePool(calls, (sql) => {
    if (sql.startsWith("INSERT INTO claim_sets")) return { rows: [{ claimSetHash }] };
    return { rows: [], rowCount: 1 };
  })));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { status: "STORED", claimSetId: "claim-set-1", claimSetHash });
});

test("blocks an invalid buyer signature before merchant or PayPal access", async () => {
  const calls = [];
  const deps = dependencies(fakePool(calls, (sql) => sql.startsWith("SELECT payload,")
    ? { rows: [{ payload: claimSet, claimSetHash }] } : { rows: [], rowCount: 1 }));
  deps.selection.verifyBuyerSignature = async () => false;
  deps.selection.merchant = { async resolveSelection() { assert.fail("invalid signatures stop before merchant resolution"); }, async fetchEvidence() { return []; } };
  const response = await handleCheckoutApiRequest(post("/api/selections", {
    claimSetId: claimSet.claimSetId, subjectRef: "jacket-1", variantRef: "blue-m", quantity: 1, fulfillmentRef: "ie-standard"
  }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "BLOCKED", reason: "CLAIM_SET_SIGNATURE_INVALID" });
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO admissions")), false);
});

test("rejects caller-supplied facts and enforces bounded JSON routes", async () => {
  let connects = 0;
  const deps = dependencies({ async connect() { connects++; throw new Error("must not connect"); } });
  const invalid = await handleCheckoutApiRequest(post("/api/selections", {
    claimSetId: "claims", subjectRef: "jacket", variantRef: "blue", quantity: 1, fulfillmentRef: "standard", price: "0.01"
  }), deps);
  assert.equal(invalid.status, 400);
  assert.equal((await handleCheckoutApiRequest(new Request("https://service.example/api/nope"), deps)).status, 404);
  assert.equal((await handleCheckoutApiRequest(new Request("https://service.example/api/selections", { method: "GET" }), deps)).status, 405);
  const tooLarge = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(130_000)); controller.close(); } });
  const largeResponse = await handleCheckoutApiRequest(new Request("https://service.example/api/selections", {
    method: "POST", headers: { "content-type": "application/json" }, body: tooLarge, duplex: "half"
  }), deps);
  assert.equal(largeResponse.status, 413);
  assert.equal(connects, 0);
});

test("exposes read-only checkout state by admission ID without a PayPal order ID", async () => {
  const deps = dependencies({ async connect() { return {
    async query() { return { rows: [{ admissionState: "AWAITING_APPROVAL", expiresAt: "2026-10-18T12:15:00.000Z", captureState: null, captureStatus: null }] }; },
    release() {}
  }; } });
  const response = await handleCheckoutApiRequest(new Request("https://service.example/api/checkouts/admission-1"), deps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { admissionState: "AWAITING_APPROVAL", expiresAt: "2026-10-18T12:15:00.000Z" });
  assert.equal("paypalOrderId" in body, false);
});

test("rejects malformed PayPal return tokens before loading an admission", async () => {
  let connects = 0;
  const deps = dependencies({ async connect() { connects++; throw new Error("must not connect"); } });
  const response = await handleCheckoutApiRequest(new Request("https://service.example/checkout/return?token=bad%20token"), deps);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "INVALID_PAYPAL_ORDER_ID" });
  assert.equal(connects, 0);
});

test("does not accept an arbitrary PayPal return token without a stored admission", async () => {
  const calls = [];
  const response = await handleCheckoutApiRequest(
    new Request("https://service.example/checkout/return?token=ORDER-UNKNOWN"),
    dependencies(fakePool(calls, () => ({ rows: [] })))
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "ADMISSION_NOT_FOUND" });
  assert.deepEqual(calls[0].values, ["ORDER-UNKNOWN"]);
});

test("serves only a verified receipt projection without exposing shipping details", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const signing = { keyId: "service-test", privateKey: pair.privateKey, trustedKeys: new Map([["service-test", pair.publicKey]]) };
  const bundle = await createEvidenceBundle({ bundleId: "admission-1", events: [
    { recordType: "ResolvedSelection", payload: { cartBinding: {
      items: [{ name: "Trail Jacket", sku: "J-1", quantity: "1" }], currency: "EUR",
      amountBreakdown: { total: "80.00" }, shipping: { address: { postalCode: "SECRET" } }
    } } },
    { recordType: "BuyerClaimSet", payload: { claims: [{ claimId: "c1", humanText: "Waterproof" }] } },
    { recordType: "AdmissionRecord", payload: { outcome: "ALLOW", policyVersion: "policy-v1" } },
    { recordType: "CaptureAttempt", payload: { state: "CLOSED_RECONCILED", paypalCaptureStatus: "COMPLETED", paypalCaptureId: "CAPTURE-1" } }
  ], seal: { closureState: "CLOSED_RECONCILED", sealedAt: "2026-10-20T12:00:00.000Z" }, keyId: signing.keyId, privateKey: signing.privateKey });
  const deps = dependencies({ async connect() { return {
    async query() { return { rows: [{ bundle }] }; }, release() {}
  }; } });
  deps.evidenceBundleSigning = signing;
  const response = await handleCheckoutApiRequest(new Request("https://service.example/api/receipts/admission-1"), deps);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.item.name, "Trail Jacket");
  assert.equal(body.capture.captureId, "CAPTURE-1");
  assert.equal(JSON.stringify(body).includes("SECRET"), false);
});

test("reports webhook setup as unavailable until the PayPal webhook ID is configured", async () => {
  const deps = dependencies({ async connect() { assert.fail("unconfigured webhooks must not access persistence"); } });
  deps.webhookId = "";
  const response = await handleCheckoutApiRequest(new Request("https://service.example/api/webhooks/paypal", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}"
  }), deps);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "PAYPAL_WEBHOOK_NOT_CONFIGURED" });
});

test("accepts approval only through the explicitly enabled replay gateway", async () => {
  let approved;
  const deps = dependencies({ async connect() { assert.fail("replay approval does not use persistence"); } });
  deps.replay = { async approveOrder(orderId) { approved = orderId; } };
  const response = await handleCheckoutApiRequest(new Request("https://service.example/api/replay/orders/REPLAY-ORDER-1/approve", { method: "POST" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { approved: true });
  assert.equal(approved, "REPLAY-ORDER-1");
  const disabled = dependencies({ async connect() { assert.fail("disabled replay must not use persistence"); } });
  assert.equal((await handleCheckoutApiRequest(new Request("https://service.example/api/replay/orders/REPLAY-ORDER-1/approve", { method: "POST" }), disabled)).status, 404);
});

test("serves only the frozen buyer-facing context from an unconsumed STEP-UP session", async () => {
  const context = {
    schemaVersion: "step-up-context-v1", claimIds: ["waterproof"], expiresAt: "2026-10-18T12:10:00.000Z",
    claimSet: {}, claimSetHash: `sha256:${"1".repeat(64)}`,
    resolvedSelection: { subjectRef: "jacket-1", subjectHash: `sha256:${"2".repeat(64)}`, cartBinding: { items: [{ name: "Trail Jacket", sku: "J-1" }] } },
    claimEvaluations: [{ claim: { claimId: "waterproof", humanText: "Waterproof jacket", overridePolicy: "HUMAN_EXACT_SUBJECT" },
      subjectRef: "jacket-1", subjectHash: `sha256:${"2".repeat(64)}`, evidenceSetHash: `sha256:${"3".repeat(64)}`,
      attestationHash: `sha256:${"4".repeat(64)}`, evidence: [{ evidenceId: "spec-1", sourceClass: "MERCHANT_TECHNICAL_SPEC",
        origin: "merchant.example/spec", fieldLocator: "technicalData.waterproof", modelView: "Water resistant fabric." }] }],
    admissionEvidence: { evidenceManifestVersion: "waterproof-v1", evidenceSetHashes: [`sha256:${"3".repeat(64)}`],
      attestationHashes: [`sha256:${"4".repeat(64)}`], overrideHashes: [] }
  };
  const contextHash = await sha256(canonicalize(context));
  const deps = dependencies({ async connect() { return {
    async query(sql) { return sql.startsWith("SELECT context")
      ? { rows: [{ context, contextHash }] } : { rows: [], rowCount: 1 }; }, release() {}
  }; } });
  const response = await handleCheckoutApiRequest(new Request("https://service.example/api/step-ups/secret-session"), deps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.subject.subjectRef, "jacket-1");
  assert.equal(body.claims[0].claimId, "waterproof");
  assert.equal(body.claims[0].evidence[0].text, "Water resistant fabric.");
  assert.equal("paypalOrderId" in body, false);
  assert.equal("claimEvaluations" in body, false);
});

test("returns a canonical, subject-bound signing payload for an allowed exact exception", async () => {
  const claimSetHash = "sha256:" + "1".repeat(64);
  const subjectHash = "sha256:" + "2".repeat(64);
  const evidenceSetHash = "sha256:" + "3".repeat(64);
  const attestationHash = "sha256:" + "4".repeat(64);
  const context = {
    schemaVersion: "step-up-context-v1", claimIds: ["claim-1"], expiresAt: "2026-10-18T12:10:00.000Z",
    claimSet: { buyerSignature: { keyId: "buyer-key" } }, claimSetHash,
    resolvedSelection: { subjectRef: "jacket-1", subjectHash, cartBinding: { currency: "GBP",
      amountBreakdown: { total: "82.50" }, items: [{ name: "RainShell", sku: "RS-1" }] } },
    claimEvaluations: [{ claim: { claimId: "claim-1", humanText: "Waterproof", value: true, overridePolicy: "HUMAN_EXACT_SUBJECT" },
      claimSetHash, subjectRef: "jacket-1", subjectHash, evidenceSetHash, attestationHash,
      evidence: [{ sourceClass: "MERCHANT_TECHNICAL_SPEC", origin: "fixture://merchant", fieldLocator: "spec", retrievedAt: "2026-10-18T12:00:00.000Z", modelView: "Water resistant." }] }],
    admissionEvidence: { evidenceManifestVersion: "waterproof-v1", evidenceSetHashes: [evidenceSetHash],
      attestationHashes: [attestationHash], overrideHashes: [] }
  };
  const contextHash = await sha256(canonicalize(context));
  const deps = dependencies({ async connect() { return {
    async query() { return { rows: [{ context, contextHash }] }; }, release() {}
  }; } });
  const response = await handleCheckoutApiRequest(new Request("https://service.example/api/step-ups/session-1"), deps);
  const body = await response.json();
  const payload = JSON.parse(body.claims[0].overrideSigningPayload);
  assert.equal(response.status, 200);
  assert.equal(body.claims[0].exceptionAllowed, true);
  assert.equal(body.claims[0].buyerKeyId, "buyer-key");
  assert.deepEqual(payload, {
    schemaVersion: "buyer-override-v1", overrideId: "id-1", claimSetHash, claimId: "claim-1", subjectRef: "jacket-1",
    subjectHash, evidenceSetHash, attestationHash, decision: "ACCEPT_EXCEPTION", expiresAt: context.expiresAt, nonce: "id-1"
  });
});

test("stores STEP-UP before returning a buyer-only decision URL", async () => {
  const binding = JSON.parse(await readFile(new URL("../fixtures/paypal/gate0-binding.example.json", import.meta.url), "utf8"));
  const signedClaimSet = { ...claimSet, buyerSignature: { alg: "ES256", keyId: "buyer-1", signatureB64: "signature" } };
  const signedClaimSetHash = await sha256(canonicalize(signedClaimSet));
  const calls = [];
  let storedContext;
  const deps = dependencies({ async connect() { return {
    async query(sql, values = []) {
      calls.push(sql);
      if (sql.startsWith("SELECT payload,")) return { rows: [{ payload: signedClaimSet, claimSetHash: signedClaimSetHash }] };
      if (sql.startsWith("INSERT INTO step_up_sessions")) { storedContext = JSON.parse(values[1]); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 1 };
    }, release() {}
  }; } });
  let id = 0;
  deps.selection.newId = () => `id-${++id}`;
  deps.selection.now = () => new Date("2026-10-18T12:01:00.000Z");
  deps.selection.verifyBuyerSignature = async () => true;
  deps.selection.merchant = {
    async resolveSelection(input) {
      return { subjectRef: input.subjectRef, subjectHash: `sha256:${"2".repeat(64)}`,
        cartBinding: binding, cartSnapshotHash: await hashCartBinding(binding) };
    },
    async fetchEvidence() { return []; }
  };
  deps.selection.getManifest = () => ({
    schemaVersion: "evidence-manifest-v1", evidenceProfileId: "waterproof-v1", requiredSourceClasses: ["MERCHANT_TECHNICAL_SPEC"],
    admissibleSourceClasses: ["MERCHANT_TECHNICAL_SPEC"], sourceAuthority: [
      { sourceClass: "MERCHANT_TECHNICAL_SPEC", rank: 90, maySatisfy: true, mayBlockIfContradictory: true }
    ], freshnessSeconds: 900, contradictionPolicy: "STEP_UP_ON_EQUAL_OR_HIGHER_AUTHORITY"
  });
  deps.selection.attestor = { async attest() { assert.fail("missing evidence must not call the attestor"); } };

  const response = await handleCheckoutApiRequest(post("/api/selections", {
    claimSetId: claimSet.claimSetId, subjectRef: "jacket-1", variantRef: "blue-m", quantity: 1, fulfillmentRef: "ie-standard"
  }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "STEP_UP", decisionUrl: "/step-up/id-2" });
  assert.equal(storedContext.schemaVersion, "step-up-context-v1");
  assert.deepEqual(storedContext.claimIds, ["waterproof"]);
  assert.equal(calls.some((sql) => sql.includes("INSERT INTO admissions")), false);
});

test("consumes a STEP-UP session when the buyer chooses another item", async () => {
  const context = {
    schemaVersion: "step-up-context-v1", claimIds: ["waterproof"], expiresAt: "2026-10-18T12:10:00.000Z",
    claimSet: {}, claimSetHash: `sha256:${"1".repeat(64)}`,
    resolvedSelection: { subjectRef: "jacket-1", subjectHash: `sha256:${"2".repeat(64)}`, cartBinding: { items: [] } },
    claimEvaluations: [{ claim: { claimId: "waterproof", humanText: "Waterproof", overridePolicy: "HUMAN_EXACT_SUBJECT" } }],
    admissionEvidence: { evidenceManifestVersion: "waterproof-v1", evidenceSetHashes: [], attestationHashes: [], overrideHashes: [] }
  };
  const contextHash = await sha256(canonicalize(context));
  let consumed = false;
  const deps = dependencies({ async connect() { return {
    async query(sql) {
      if (sql.startsWith("SELECT context")) return { rows: [{ context, contextHash }] };
      if (sql.startsWith("UPDATE step_up_sessions")) { consumed = true; return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 1 };
    }, release() {}
  }; } });
  const response = await handleCheckoutApiRequest(post("/api/step-ups/session-1", { decision: "CHOOSE_ANOTHER" }), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "CHOOSE_ANOTHER" });
  assert.equal(consumed, true);
});

function post(path, body) {
  return new Request(`https://service.example${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
}

function dependencies(pool) {
  return {
    pool, gateway: { async createOrder() { assert.fail("invalid requests never call PayPal"); }, async getOrder() {}, async captureOrder() {} },
    selection: {
      verifyBuyerSignature: async () => true,
      merchant: { async resolveSelection() { return {}; }, async fetchEvidence() { return []; } },
      getManifest: () => ({}), getAttestorConfig: () => ({}), attestor: { async attest() { return {}; } },
      newId: () => "id-1", now: () => new Date("2026-10-18T12:01:00.000Z")
    },
    webhookId: "webhook-1", policyVersion: "policy-v1"
  };
}

function fakePool(calls, respond) {
  return { async connect() { return {
    async query(sql, values) { calls.push({ sql, values }); return respond(sql, values); }, release() {}
  }; } };
}
