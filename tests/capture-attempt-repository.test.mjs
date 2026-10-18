import assert from "node:assert/strict";
import test from "node:test";
import { startCaptureAttempt } from "../dist/persistence/CaptureAttemptRepository.js";

const attempt = {
  schemaVersion: "capture-attempt-v1",
  attemptId: "attempt-1",
  admissionId: "admission-1",
  paypalOrderId: "order-1",
  materialHash: "sha256:binding",
  paypalRequestId: "request-1",
  state: "IN_FLIGHT",
  createdAt: "2026-10-18T12:01:00.000Z",
  updatedAt: "2026-10-18T12:01:00.000Z"
};
const now = "2026-10-18T12:02:00.000Z";

test("creates one capture attempt in the same transaction that claims the admission", async () => {
  const { pool, calls } = fakePool([
    { rows: [] },
    { rows: [] },
    { rows: [{ admissionId: "admission-1" }] },
    { rows: [attempt] },
    { rows: [], rowCount: 1 },
    { rows: [] }
  ]);
  assert.deepEqual(await startCaptureAttempt(pool, attempt, now), attempt);
  assert.deepEqual(calls.map(({ sql }) => sql.trim().split(/\s+/)[0]), ["BEGIN", "SELECT", "SELECT", "INSERT", "UPDATE", "COMMIT"]);
  assert.equal(calls[2].values[2], now);
  assert.equal(calls[3].values[4], "request-1");
});

test("returns the existing active attempt without issuing a second capture request", async () => {
  const { pool, calls } = fakePool([{ rows: [] }, { rows: [attempt] }, { rows: [] }]);
  assert.deepEqual(await startCaptureAttempt(pool, { ...attempt, attemptId: "new" }, now), attempt);
  assert.equal(calls.some(({ sql }) => sql.trim().startsWith("INSERT")), false);
});

test("rolls back when the admission is missing, expired or already claimed", async () => {
  const { pool, calls } = fakePool([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);
  await assert.rejects(startCaptureAttempt(pool, attempt, now), { message: "ADMISSION_NOT_CAPTUREABLE" });
  assert.equal(calls.at(-1).sql, "ROLLBACK");
});

function fakePool(results) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return results.shift() ?? { rows: [], rowCount: 1 };
    },
    release() {}
  };
  return { pool: { async connect() { return client; } }, calls };
}
