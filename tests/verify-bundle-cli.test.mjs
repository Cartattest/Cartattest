import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createEvidenceBundle } from "../dist/bundle/EvidenceBundle.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privateCryptoKey = await crypto.subtle.importKey("pkcs8", privateKey.export({ format: "der", type: "pkcs8" }),
  { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const bundle = await createEvidenceBundle({ bundleId: "verify-cli-test", events: [{ recordType: "AdmissionRecord", payload: { admissionId: "a-1" } }],
  seal: { closureState: "CLOSED_RECONCILED", sealedAt: "2026-10-20T12:00:00.000Z" }, keyId: "service-test", privateKey: privateCryptoKey });

test("offline CLI verifies with the externally supplied pinned public key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cartattest-verify-"));
  try {
    const bundlePath = join(directory, "bundle.json");
    const keyPath = join(directory, "service.pem");
    await writeFile(bundlePath, JSON.stringify(bundle));
    await writeFile(keyPath, publicKey.export({ type: "spki", format: "pem" }));
    const result = spawnSync(process.execPath, ["scripts/verify-bundle.mjs", bundlePath, "service-test", keyPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /VERIFIED bundle=verify-cli-test records=1 key=service-test/);

    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const wrongKeyPath = join(directory, "wrong.pem");
    await writeFile(wrongKeyPath, other.publicKey.export({ type: "spki", format: "pem" }));
    const rejected = spawnSync(process.execPath, ["scripts/verify-bundle.mjs", bundlePath, "service-test", wrongKeyPath], { encoding: "utf8" });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /INVALID BUNDLE_SIGNATURE_INVALID/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
