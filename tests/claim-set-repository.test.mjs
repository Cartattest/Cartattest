import assert from "node:assert/strict";
import test from "node:test";
import { saveClaimSet, loadClaimSet } from "../dist/persistence/ClaimSetRepository.js";
import { sha256 } from "../dist/domain/Hash.js";
import canonicalize from "canonicalize";

const claimSet = {
  schemaVersion: "claim-set-v1",
  claimSetId: "claim-set-1",
  buyerRequestText: "Find a waterproof jacket under GBP 100.",
  claims: [{ claimId: "waterproof", kind: "SEMANTIC_BOOLEAN", humanText: "Waterproof", operator: "SUPPORTED", value: true, evidenceProfileId: "waterproof-v1", overridePolicy: "HUMAN_EXACT_SUBJECT" }],
  createdAt: "2026-10-18T12:00:00.000Z",
  expiresAt: "2026-10-18T12:15:00.000Z"
};

test("saves a validated Claim Set with a canonical content hash", async () => {
  const { pool, calls } = fakePool([{ rows: [] }, { rows: [{ claimSetHash: await hashClaimSet(claimSet) }] }, { rows: [] }]);
  assert.equal(await saveClaimSet(pool, claimSet), await hashClaimSet(claimSet));
  assert.match(calls[1].sql, /INSERT INTO claim_sets/);
  assert.equal(calls[1].values[0], claimSet.claimSetId);
});

test("loads the stored Claim Set only when its persisted hash matches", async () => {
  const claimSetHash = await hashClaimSet(claimSet);
  const { pool } = fakePool([{ rows: [{ payload: claimSet, claimSetHash }] }]);
  assert.deepEqual(await loadClaimSet(pool, claimSet.claimSetId), { claimSet, claimSetHash });
});

test("rejects conflicting IDs and tampered stored payloads", async () => {
  const otherHash = await sha256("different");
  const conflict = fakePool([{ rows: [] }, { rows: [{ payload: { ...claimSet, buyerRequestText: "changed" }, claimSetHash: otherHash }] }, { rows: [] }]);
  await assert.rejects(saveClaimSet(conflict.pool, claimSet), { message: "CLAIM_SET_ID_CONFLICT" });

  const tampered = fakePool([{ rows: [{ payload: { ...claimSet, buyerRequestText: "changed" }, claimSetHash: await hashClaimSet(claimSet) }] }]);
  await assert.rejects(loadClaimSet(tampered.pool, claimSet.claimSetId), { message: "CLAIM_SET_INTEGRITY_FAILURE" });
});

async function hashClaimSet(value) {
  return sha256(canonicalize(value));
}

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
