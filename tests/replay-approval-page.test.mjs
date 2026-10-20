import assert from "node:assert/strict";
import test from "node:test";
import { handleReplayApprovalPageRequest } from "../dist/server/ReplayApprovalPage.js";

test("serves an explicit simulated-approval screen for replay orders", async () => {
  const response = handleReplayApprovalPageRequest(new Request("https://service.example/replay/approve?token=REPLAY-ORDER-test-session-1"));
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /Simulated replay approval/);
  assert.match(page, /"\/api\/replay\/orders\/"\+orderId\+"\/approve"/);
  assert.match(page, /checkout\/return\?token=/);
});

test("rejects unsafe or incomplete replay approval links", () => {
  assert.equal(handleReplayApprovalPageRequest(new Request("https://service.example/replay/approve?token=bad%20token"))?.status, 400);
  assert.equal(handleReplayApprovalPageRequest(new Request("https://service.example/replay/approve"))?.status, 400);
  assert.equal(handleReplayApprovalPageRequest(new Request("https://service.example/replay/approve?token=REPLAY-ORDER-test-session-1", { method: "POST" }))?.status, 405);
});
