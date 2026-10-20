import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { applyCheckoutSchema, applySchemaMigration } from "../dist/persistence/SchemaMigration.js";

test("applies the checkout schema once inside a transaction", async () => {
  const calls = [];
  let applied = false;
  const pool = fakePool(calls, (sql) => {
    if (sql.startsWith("SELECT version")) return { rows: applied ? [{ version: "0001_checkout" }] : [] };
    if (sql === "CREATE TABLE custom_schema ()") applied = true;
    return { rows: [], rowCount: 1 };
  });
  assert.equal(await applyCheckoutSchema(pool, "CREATE TABLE custom_schema ();"), true);
  assert.equal(calls[0].sql, "BEGIN");
  assert.match(calls[1].sql, /pg_advisory_xact_lock/);
  assert.ok(calls.some((call) => call.sql === "COMMIT"));
  assert.deepEqual(calls.find((call) => call.sql.startsWith("INSERT INTO schema_migrations")).values, ["0001_checkout"]);
});

test("skips an applied version and rolls back a failed schema transaction", async () => {
  const existingCalls = [];
  assert.equal(await applyCheckoutSchema(fakePool(existingCalls, (sql) => sql.startsWith("SELECT version")
    ? { rows: [{ version: "0001_checkout" }] } : { rows: [], rowCount: 1 }), "CREATE TABLE ignored ();"), false);
  assert.equal(existingCalls.some((call) => call.sql === "CREATE TABLE ignored ();"), false);

  const failedCalls = [];
  await assert.rejects(applyCheckoutSchema(fakePool(failedCalls, (sql) => {
    if (sql === "BROKEN SQL") throw new Error("database rejected schema");
    return { rows: [] };
  }), "BROKEN SQL"), { message: "database rejected schema" });
  assert.equal(failedCalls.at(-1).sql, "ROLLBACK");
});

test("applies step-up sessions as a separately versioned migration", async () => {
  const calls = [];
  const pool = fakePool(calls, (sql, values) => {
    if (sql.startsWith("SELECT version")) return { rows: values[0] === "0002_step_up_sessions" ? [] : [{ version: values[0] }] };
    return { rows: [], rowCount: 1 };
  });
  assert.equal(await applySchemaMigration(pool, "0002_step_up_sessions", "CREATE TABLE step_up_sessions ();"), true);
  assert.ok(calls.some((call) => call.sql === "CREATE TABLE step_up_sessions ();"));
  assert.deepEqual(calls.find((call) => call.sql.startsWith("INSERT INTO schema_migrations")).values, ["0002_step_up_sessions"]);
});

test("allows an order-creation admission to abort before a PayPal order ID exists", async () => {
  const sql = await readFile(new URL("../db/0005_abort_creating_order.sql", import.meta.url), "utf8");
  assert.match(sql, /DROP CONSTRAINT IF EXISTS admissions_check1/);
  assert.match(sql, /state = 'ABORTED'/);
  const calls = [];
  await applySchemaMigration(fakePool(calls, () => ({ rows: [], rowCount: 1 })), "0005_abort_creating_order", sql);
  assert.ok(calls.some((call) => call.sql === sql));
});

function fakePool(calls, respond) {
  return { async connect() { return {
    async query(sql, values = []) { calls.push({ sql, values }); return respond(sql, values); }, release() {}
  }; } };
}
