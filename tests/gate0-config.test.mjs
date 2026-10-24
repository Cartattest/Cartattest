import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Gate 0 order creation requires buyer return URLs", () => {
  const env = { ...process.env };
  for (const name of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_RETURN_URL", "PAYPAL_CANCEL_URL"]) {
    delete env[name];
  }
  const result = spawnSync(process.execPath, ["scripts/gate0.mjs", "create", "fixtures/paypal/gate0-binding.example.json"], {
    cwd: process.cwd(), env, encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PAYPAL_RETURN_URLS_REQUIRED/);
});
