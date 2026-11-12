import assert from "node:assert/strict";
import test from "node:test";
import { listDecisions, recordDecision } from "../dist/persistence/DecisionLogRepository.js";
import { handleDecisionLogPageRequest } from "../dist/server/DecisionLogPage.js";

function fakePool(rows = []) {
  const queries = [];
  return { queries, async connect() { return { async query(sql, values) { queries.push({ sql, values }); return { rows }; }, release() {} }; } };
}

test("records a decision with its summary as JSON", async () => {
  const pool = fakePool();
  await recordDecision(pool, { decisionId: "d1", createdAt: "2026-11-12T03:00:00.000Z", source: "SELECTION", outcome: "STEP_UP",
    reason: "waterproof", stepUpSessionId: "s1", summary: { itemName: "RainShell Lite" } });
  assert.match(pool.queries[0].sql, /INSERT INTO decision_log/);
  assert.equal(pool.queries[0].values[5], "STEP_UP");
  assert.deepEqual(JSON.parse(pool.queries[0].values[9]), { itemName: "RainShell Lite" });
});

test("rejects an unknown outcome", async () => {
  await assert.rejects(recordDecision(fakePool(), { decisionId: "d1", createdAt: "2026-11-12T03:00:00.000Z", source: "SELECTION",
    outcome: "MAYBE", summary: {} }), /INVALID_DECISION_LOG_ENTRY/);
});

test("lists decisions with live PayPal and receipt state", async () => {
  const pool = fakePool([{ decision_id: "d1", created_at: "2026-11-12T03:00:00.000Z", source: "SELECTION", outcome: "ALLOW",
    admission_id: "a1", summary: { itemName: "StormGuard" }, paypal_order_id: "ORDER-1", admission_state: "CLOSED",
    capture_state: "CLOSED_RECONCILED", paypal_capture_status: "COMPLETED", receipt_available: true }]);
  const [row] = await listDecisions(pool, 10);
  assert.equal(row.paypalOrderId, "ORDER-1");
  assert.equal(row.captureStatus, "COMPLETED");
  assert.equal(row.receiptAvailable, true);
  assert.deepEqual(pool.queries[0].values, [10]);
});

test("serves the decision log page and the local AG Grid script", async () => {
  const page = await handleDecisionLogPageRequest(new Request("http://localhost/decisions"));
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(await page.text(), /agGrid\.createGrid/);
  const script = await handleDecisionLogPageRequest(new Request("http://localhost/assets/ag-grid-community.min.js"));
  assert.equal(script.status, 200);
  assert.ok((await script.arrayBuffer()).byteLength > 100_000);
  assert.equal(await handleDecisionLogPageRequest(new Request("http://localhost/other")), undefined);
});
