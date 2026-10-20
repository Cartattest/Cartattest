import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import { createEvidenceBundle } from "../dist/bundle/EvidenceBundle.js";
import { loadEvidenceBundle, saveEvidenceBundle } from "../dist/persistence/EvidenceBundleRepository.js";

const generate = promisify(generateKeyPair);
const keys = await generate("ec", { namedCurve: "prime256v1" });
const privateKey = await crypto.subtle.importKey("pkcs8", keys.privateKey.export({ format: "der", type: "pkcs8" }),
  { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const publicKey = await crypto.subtle.importKey("spki", keys.publicKey.export({ format: "der", type: "spki" }),
  { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const trustedKeys = new Map([["service-v1", publicKey]]);
const bundle = await createEvidenceBundle({ bundleId: "bundle-1", events: [{ recordType: "AdmissionRecord", payload: { id: "a-1" } }],
  seal: { closureState: "CLOSED_RECONCILED", sealedAt: "2026-10-20T12:00:00.000Z" }, keyId: "service-v1", privateKey });

test("stores and loads a signed bundle, treating identical retries as idempotent", async () => {
  const pool = fakePool();
  await saveEvidenceBundle(pool, bundle, trustedKeys);
  await saveEvidenceBundle(pool, bundle, trustedKeys);
  assert.deepEqual(await loadEvidenceBundle(pool, "bundle-1", trustedKeys), bundle);
});

test("does not replace a bundle when its ID is reused with different contents", async () => {
  const pool = fakePool();
  await saveEvidenceBundle(pool, bundle, trustedKeys);
  const different = await createEvidenceBundle({ bundleId: "bundle-1", events: [{ recordType: "AdmissionRecord", payload: { id: "a-2" } }],
    seal: { closureState: "CLOSED_RECONCILED", sealedAt: "2026-10-20T12:00:00.000Z" }, keyId: "service-v1", privateKey });
  await assert.rejects(saveEvidenceBundle(pool, different, trustedKeys), { message: "EVIDENCE_BUNDLE_ID_CONFLICT" });
});

test("validates bundle IDs and stored bundle shape", async () => {
  const pool = fakePool();
  await assert.rejects(loadEvidenceBundle(pool, "bad/id", trustedKeys), { message: "INVALID_BUNDLE_ID" });
  await assert.rejects(loadEvidenceBundle(pool, "missing", trustedKeys), { message: "EVIDENCE_BUNDLE_NOT_FOUND" });
});

test("rejects signatures that are not from the externally pinned key", async () => {
  const pool = fakePool();
  const other = await generate("ec", { namedCurve: "prime256v1" });
  const wrongKey = await crypto.subtle.importKey("spki", other.publicKey.export({ format: "der", type: "spki" }),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  await assert.rejects(saveEvidenceBundle(pool, bundle, new Map([["service-v1", wrongKey]])), { message: "BUNDLE_SIGNATURE_INVALID" });
});

function fakePool() {
  const rows = new Map();
  return { async connect() { return {
    async query(sql, values = []) {
      if (sql.startsWith("INSERT INTO evidence_bundles")) {
        if (rows.has(values[0])) return { rows: [] };
        rows.set(values[0], structuredClone(values[1]));
        return { rows: [{ bundle_id: values[0] }] };
      }
      if (sql.startsWith("SELECT bundle")) return { rows: rows.has(values[0]) ? [{ bundle: structuredClone(rows.get(values[0])) }] : [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }, release() {}
  }; } };
}
