import assert from "node:assert/strict";
import test from "node:test";
import { createCheckoutHttpServer } from "../dist/server/CheckoutHttpServer.js";

test("serves the checkout Fetch API over a local HTTP listener", async () => {
  const server = createCheckoutHttpServer({});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/missing`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
