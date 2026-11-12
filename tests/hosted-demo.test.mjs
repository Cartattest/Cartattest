import assert from "node:assert/strict";
import test from "node:test";
import { createHostedDemo, displayTotal, FixedWindowLimiter } from "../dist/server/HostedDemo.js";
import { loadOrCreateHostedDemoKeys } from "../dist/persistence/HostedDemoKeyRepository.js";
import { handleHomePageRequest } from "../dist/server/HomePage.js";
import { verifyClaimSetSignature } from "../dist/security/BuyerSignatures.js";

const catalogue = {
  products: [
    { subjectRef: "jacket-a", name: "Jacket A", variants: [{ variantRef: "m", unitAmount: "79.00", currency: "GBP", tax: "0.00" }] },
    { subjectRef: "jacket-b", name: "Jacket B", variants: [{ variantRef: "m", unitAmount: "94.00", currency: "GBP", tax: "0.00" }] }
  ],
  fulfillments: [{ fulfillmentRef: "standard", shipping: { amount: "3.50" } }]
};

async function demoKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { privateKey: pair.privateKey, trusted: new Map([["buyer-hosted-demo-v1", pair.publicKey]]) };
}

function fakeApi(trusted) {
  const calls = [];
  return {
    calls,
    async callApi(request) {
      const body = JSON.parse(await request.text());
      const path = new URL(request.url).pathname;
      calls.push({ path, body });
      if (path === "/api/claim-sets") {
        const valid = await verifyClaimSetSignature(body, trusted);
        return Response.json(valid ? { status: "STORED" } : { error: "CLAIM_SET_SIGNATURE_INVALID" }, { status: valid ? 201 : 400 });
      }
      if (body.subjectRef === "jacket-a") {
        return Response.json({ status: "STEP_UP", decisionUrl: "/step-up/s1", evidenceChecks: [{ claimId: "waterproof", result: "CONTRADICTED",
          modelId: "m", supportQuotes: [], contradictionQuotes: [{ sourceClass: "MERCHANT_TECHNICAL_SPEC", verbatim: "Water-resistant shell only." }] }] });
      }
      return Response.json({ status: "ALLOWED", admissionId: "a1", approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=X" });
    }
  };
}

const run = (handler, ip = "1.2.3.4") => handler(new Request("http://localhost/api/demo/run", { method: "POST" }), ip);

test("hosted demo signs a valid buyer Claim Set and proposes only identifiers through the selection API", async () => {
  const keys = await demoKeys();
  const api = fakeApi(keys.trusted);
  const handler = createHostedDemo({ callApi: api.callApi, buyerPrivateKey: keys.privateKey, buyerKeyId: "buyer-hosted-demo-v1", catalogue });
  const response = await run(handler);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.proposals.map((p) => [p.itemName, p.price, p.status]),
    [["Jacket A", "GBP 82.50", "STEP_UP"], ["Jacket B", "GBP 97.50", "ALLOWED"]]);
  assert.equal(result.proposals[0].decisionUrl, "/step-up/s1");
  assert.equal(result.proposals[0].evidenceChecks[0].result, "CONTRADICTED");
  assert.match(result.proposals[1].approvalUrl, /^https:\/\/www\.sandbox\.paypal\.com\//);
  const selections = api.calls.filter((call) => call.path === "/api/selections");
  assert.equal(selections.length, 2);
  for (const call of selections) {
    assert.deepEqual(Object.keys(call.body).sort(), ["claimSetId", "fulfillmentRef", "quantity", "subjectRef", "variantRef"]);
  }
});

test("hosted demo rate-limits each client and fails without exposing internals", async () => {
  const keys = await demoKeys();
  const api = fakeApi(keys.trusted);
  const handler = createHostedDemo({ callApi: api.callApi, buyerPrivateKey: keys.privateKey, buyerKeyId: "buyer-hosted-demo-v1",
    catalogue, perClientLimit: 2, now: () => 1_000 });
  assert.equal((await run(handler)).status, 200);
  assert.equal((await run(handler)).status, 200);
  const limited = await run(handler);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, "DEMO_RATE_LIMITED");
  assert.equal((await run(handler, "5.6.7.8")).status, 200);

  const wrongKey = createHostedDemo({ callApi: api.callApi, buyerPrivateKey: (await demoKeys()).privateKey,
    buyerKeyId: "buyer-hosted-demo-v1", catalogue });
  const failed = await run(wrongKey);
  assert.equal(failed.status, 502);
  assert.deepEqual(Object.keys(await failed.json()).sort(), ["error", "message"]);
});

test("hosted demo serves its page, rejects other methods and ignores unrelated paths", async () => {
  const keys = await demoKeys();
  const handler = createHostedDemo({ callApi: fakeApi(keys.trusted).callApi, buyerPrivateKey: keys.privateKey, buyerKeyId: "k", catalogue });
  const page = await handler(new Request("http://localhost/demo"), "ip");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(await page.text(), /Run the shopping agent/);
  assert.equal((await handler(new Request("http://localhost/api/demo/run"), "ip")).status, 405);
  assert.equal(await handler(new Request("http://localhost/decisions"), "ip"), undefined);
});

test("fixed-window limiter resets after its window", () => {
  let time = 0;
  const limiter = new FixedWindowLimiter(1, 100, () => time);
  assert.equal(limiter.take("a"), true);
  assert.equal(limiter.take("a"), false);
  time = 100;
  assert.equal(limiter.take("a"), true);
});

test("display total adds item, tax and shipping in pence", () => {
  assert.equal(displayTotal("94.00", "0.00", "3.50"), "97.50");
  assert.equal(displayTotal("0.1", "0.2"), "0.30");
  assert.equal(displayTotal("1e3"), "?");
});

test("hosted demo keys are created once and reused after a restart", async () => {
  let stored;
  let inserts = 0;
  const pool = { async connect() { return {
    async query(sql, values) {
      if (/^\s*INSERT/.test(sql)) { inserts += 1; stored ??= values; return { rows: [] }; }
      return { rows: stored ? [{ buyer_private_pem: stored[0], buyer_public_pem: stored[1], service_private_pem: stored[2], service_public_pem: stored[3] }] : [] };
    },
    release() {}
  }; } };
  const first = await loadOrCreateHostedDemoKeys(pool);
  const second = await loadOrCreateHostedDemoKeys(pool);
  assert.equal(inserts, 1);
  assert.deepEqual(second, first);
  assert.match(first.buyerPrivatePem, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.notEqual(first.buyerPrivatePem, first.servicePrivatePem);
});

test("home page offers the agent run only in hosted demo mode", async () => {
  const hosted = await handleHomePageRequest(new Request("http://localhost/"), { hostedDemo: true }).text();
  const local = await handleHomePageRequest(new Request("http://localhost/")).text();
  assert.match(hosted, /href="\/demo"/);
  assert.doesNotMatch(hosted, /local buyer signing key/);
  assert.doesNotMatch(local, /href="\/demo"/);
  assert.match(local, /local buyer signing key/);
});
