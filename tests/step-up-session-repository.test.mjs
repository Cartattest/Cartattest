import assert from "node:assert/strict";
import test from "node:test";
import { consumeStepUpSession, loadStepUpSession, saveStepUpSession } from "../dist/persistence/StepUpSessionRepository.js";

const now = "2026-10-18T12:00:00.000Z";
const context = { schemaVersion: "step-up-context-v1", claimIds: ["waterproof"] };

test("stores and loads a hash-checked step-up context until it is consumed", async () => {
  const calls = [];
  let row;
  const pool = fakePool(calls, (sql, values) => {
    if (sql.startsWith("INSERT INTO step_up_sessions")) {
      row = { context, contextHash: values[2], expiresAt: values[4] };
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("SELECT context")) return { rows: row && !row.consumedAt && row.expiresAt > values[1] ? [row] : [] };
    if (sql.startsWith("UPDATE step_up_sessions")) {
      if (!row || row.consumedAt || row.expiresAt <= values[1]) return { rows: [], rowCount: 0 };
      row.consumedAt = values[1];
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });

  await saveStepUpSession(pool, { sessionId: "step-1", context, createdAt: now, expiresAt: "2026-10-18T12:10:00.000Z" });
  assert.deepEqual(await loadStepUpSession(pool, "step-1", now), context);
  await consumeStepUpSession(pool, "step-1", now);
  await assert.rejects(loadStepUpSession(pool, "step-1", now), { message: "STEP_UP_SESSION_UNAVAILABLE" });
});

test("rejects a tampered step-up context and expired sessions", async () => {
  const pool = fakePool([], (sql, values) => sql.startsWith("SELECT context")
    ? { rows: Date.parse(values[1]) < Date.parse("2026-10-18T12:10:00.000Z")
      ? [{ context: { ...context, claimIds: ["other"] }, contextHash: "sha256:" + "0".repeat(64), expiresAt: "2026-10-18T12:10:00.000Z" }]
      : [] }
    : { rows: [], rowCount: 0 });
  await assert.rejects(loadStepUpSession(pool, "step-1", now), { message: "STEP_UP_SESSION_INTEGRITY_FAILURE" });
  await assert.rejects(loadStepUpSession(pool, "step-1", "2026-10-18T12:11:00.000Z"), { message: "STEP_UP_SESSION_UNAVAILABLE" });
});

function fakePool(calls, respond) {
  return { async connect() { return {
    async query(sql, values = []) { calls.push({ sql, values }); return respond(sql, values); },
    release() {}
  }; } };
}
