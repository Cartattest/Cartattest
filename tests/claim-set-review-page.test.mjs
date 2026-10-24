import assert from "node:assert/strict";
import test from "node:test";
import { handleClaimSetReviewPageRequest } from "../dist/server/ClaimSetReviewPage.js";

test("serves a buyer constraint review that signs in the browser", async () => {
  const response = handleClaimSetReviewPageRequest(new Request("https://service.example/claim-set/review"));
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Review your purchase requirements/);
  assert.match(page, /api\/claim-sets\/prepare/);
  assert.match(page, /api\/claim-sets/);
  assert.match(page, /crypto\.subtle\.sign/);
  assert.match(page, /draft\.addEventListener\("input"/);
  assert.match(page, /textContent/);
  assert.doesNotMatch(page, /innerHTML/);
});

test("restricts the buyer Claim Set review route to GET", () => {
  assert.equal(handleClaimSetReviewPageRequest(new Request("https://service.example/claim-set/review", { method: "POST" }))?.status, 405);
  assert.equal(handleClaimSetReviewPageRequest(new Request("https://service.example/unknown")), undefined);
});
