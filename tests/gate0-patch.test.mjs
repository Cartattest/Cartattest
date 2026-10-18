import assert from "node:assert/strict";
import test from "node:test";
import { patchSandboxOrder } from "../scripts/gate0-patch.mjs";

test("patches a sandbox order with JSON Patch using a server-side OAuth token", async () => {
  const calls = [];
  const result = await patchSandboxOrder({
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    orderId: "SANDBOX-ORDER-1",
    patchOperations: [{
      op: "replace",
      path: "/purchase_units/@reference_id=='default'/custom_id",
      value: "gate0-mutation"
    }],
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/oauth2/token")) {
        return json({ access_token: "sandbox-token", expires_in: 3600 });
      }
      return new Response(null, { status: 204 });
    }
  });

  assert.deepEqual(result, { status: 204 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api-m.sandbox.paypal.com/v1/oauth2/token");
  assert.equal(calls[1].url, "https://api-m.sandbox.paypal.com/v2/checkout/orders/SANDBOX-ORDER-1");
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(calls[1].init.headers.Authorization, "Bearer sandbox-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), [{
    op: "replace",
    path: "/purchase_units/@reference_id=='default'/custom_id",
    value: "gate0-mutation"
  }]);
});

test("rejects invalid order IDs and patch operations before making a request", async () => {
  let calls = 0;
  const options = {
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    orderId: "bad/order",
    patchOperations: [{ op: "replace", path: "/intent", value: "AUTHORIZE" }],
    fetch: async () => { calls++; return new Response(null, { status: 204 }); }
  };

  await assert.rejects(patchSandboxOrder(options), { message: "INVALID_PAYPAL_ORDER_ID" });
  await assert.rejects(patchSandboxOrder({ ...options, orderId: "SANDBOX-ORDER-1", patchOperations: [] }), {
    message: "PAYPAL_PATCH_OPERATIONS_REQUIRED"
  });
  await assert.rejects(patchSandboxOrder({
    ...options,
    orderId: "SANDBOX-ORDER-1",
    patchOperations: [{ op: "move", path: "/intent" }]
  }), { message: "PAYPAL_PATCH_OPERATION_INVALID" });
  assert.equal(calls, 0);
});

test("surfaces a sanitized PayPal PATCH failure", async () => {
  const result = patchSandboxOrder({
    clientId: "sandbox-client",
    clientSecret: "sandbox-secret",
    orderId: "SANDBOX-ORDER-1",
    patchOperations: [{ op: "replace", path: "/intent", value: "AUTHORIZE" }],
    fetch: async (url) => String(url).endsWith("/v1/oauth2/token")
      ? json({ access_token: "sandbox-token", expires_in: 3600 })
      : json({ name: "UNPROCESSABLE_ENTITY", debug_id: "private-debug-id" }, 422)
  });

  await assert.rejects(result, (error) => {
    assert.match(error.message, /PAYPAL_API_FAILED 422 UNPROCESSABLE_ENTITY/);
    assert.doesNotMatch(error.message, /private-debug-id/);
    return true;
  });
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
