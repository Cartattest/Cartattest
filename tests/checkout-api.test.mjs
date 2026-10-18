import assert from "node:assert/strict";
import canonicalize from "canonicalize";
import test from "node:test";
import { handleCheckoutApiRequest } from "../dist/api/CheckoutApi.js";
import { sha256 } from "../dist/domain/Hash.js";

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
