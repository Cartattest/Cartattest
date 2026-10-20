import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("keygen creates a private buyer key with restrictive permissions and refuses overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cartattest-keygen-"));
  const prefix = join(directory, "buyer");
  const privatePath = prefix + ".private.pem";
  const publicPath = prefix + ".public.pem";
  try {
    const result = spawnSync(process.execPath, ["scripts/generate-es256-key.mjs", "buyer-1", prefix], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(privatePath, "utf8"), /BEGIN PRIVATE KEY/);
    assert.match(await readFile(publicPath, "utf8"), /BEGIN PUBLIC KEY/);
    assert.equal((await stat(privatePath)).mode & 0o777, 0o600);

    const before = await readFile(privatePath, "utf8");
    const rejected = spawnSync(process.execPath, ["scripts/generate-es256-key.mjs", "buyer-1", prefix], { encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.equal(await readFile(privatePath, "utf8"), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
