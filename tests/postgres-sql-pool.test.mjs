import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresSqlPool } from "../dist/persistence/PostgresSqlPool.js";

test("accepts a PostgreSQL connection URL and exposes pool shutdown", async () => {
  const pool = createPostgresSqlPool("postgresql://cartattest:secret@localhost:5432/cartattest");
  assert.equal(typeof pool.connect, "function");
  await pool.end();
});

test("rejects malformed or non-PostgreSQL URLs before opening connections", () => {
  for (const value of ["", "not a URL", "https://db.example/cart", "postgresql:///", "postgres://localhost"]) {
    assert.throws(() => createPostgresSqlPool(value), { message: "DATABASE_URL_INVALID" });
  }
});
