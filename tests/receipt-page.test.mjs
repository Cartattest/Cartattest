import assert from "node:assert/strict";
import test from "node:test";
import { handleReceiptPageRequest } from "../dist/server/ReceiptPage.js";

test("serves the receipt screen with a safe encoded bundle identifier", async () => {
  const response = handleReceiptPageRequest(new Request("https://service.example/receipt/admission-1"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const html = await response.text();
  assert.match(html, /Verified purchase record/);
  assert.match(html, /api\/receipts\/admission-1/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /innerHTML/);
});

test("rejects malformed receipt routes and non-GET methods", () => {
  assert.equal(handleReceiptPageRequest(new Request("https://service.example/receipt/%2F"))?.status, 400);
  assert.equal(handleReceiptPageRequest(new Request("https://service.example/receipt/id", { method: "POST" }))?.status, 405);
  assert.equal(handleReceiptPageRequest(new Request("https://service.example/not-a-receipt")), undefined);
});
