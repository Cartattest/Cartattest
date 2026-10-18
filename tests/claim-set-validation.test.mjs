import assert from "node:assert/strict";
import test from "node:test";
import { parseClaimSetV1 } from "../dist/api/ClaimSetValidation.js";

const claimSet = {
  schemaVersion: "claim-set-v1",
  claimSetId: "claim-set-1",
  buyerRequestText: "Find a waterproof jacket under GBP 100.",
  claims: [
    {
      claimId: "semantic-waterproof",
      kind: "SEMANTIC_BOOLEAN",
      humanText: "The jacket must be waterproof.",
      operator: "SUPPORTED",
      value: true,
      evidenceProfileId: "waterproof-v1",
      overridePolicy: "HUMAN_EXACT_SUBJECT"
    },
    {
      claimId: "budget-1",
      kind: "BUDGET_MAX",
      humanText: "Total price must not exceed GBP 100.",
      operator: "LTE",
      value: 100,
      currency: "GBP",
      overridePolicy: "NEVER"
    }
  ],
  createdAt: "2026-10-18T12:00:00.000Z",
  expiresAt: "2026-10-18T12:15:00.000Z"
};

test("accepts a valid Claim Set and returns its canonical contract fields", () => {
  assert.deepEqual(parseClaimSetV1(claimSet), claimSet);
});

test("applies the schema default when a claim omits its operator", () => {
  const claim = { ...claimSet.claims[0] };
  delete claim.operator;
  const parsed = parseClaimSetV1({ ...claimSet, claims: [claim] });
  assert.equal(parsed.claims[0].operator, "SUPPORTED");
});

test("rejects extra properties and duplicate claim IDs", () => {
  assert.throws(() => parseClaimSetV1({ ...claimSet, price: "0.01" }), { message: "INVALID_CLAIM_SET" });
  assert.throws(() => parseClaimSetV1({ ...claimSet, claims: [claimSet.claims[0], claimSet.claims[0]] }), {
    message: "INVALID_CLAIM_SET"
  });
});

test("rejects malformed claim fields and non-relaxable overrides", () => {
  assert.throws(() => parseClaimSetV1({ ...claimSet, claims: [{ ...claimSet.claims[0], kind: "UNKNOWN" }] }), {
    message: "INVALID_CLAIM_SET"
  });
  assert.throws(() => parseClaimSetV1({ ...claimSet, claims: [{ ...claimSet.claims[1], overridePolicy: "HUMAN_EXACT_SUBJECT" }] }), {
    message: "INVALID_CLAIM_SET"
  });
  assert.throws(() => parseClaimSetV1({ ...claimSet, claims: [{ ...claimSet.claims[0], value: Number.NaN }] }), {
    message: "INVALID_CLAIM_SET"
  });
});

test("requires a nonempty lifetime and a valid optional signature shape", () => {
  assert.throws(() => parseClaimSetV1({ ...claimSet, expiresAt: claimSet.createdAt }), { message: "INVALID_CLAIM_SET" });
  assert.throws(() => parseClaimSetV1({ ...claimSet, buyerSignature: { alg: "RS256", keyId: "k1", signatureB64: "sig" } }), {
    message: "INVALID_CLAIM_SET"
  });
});

test("rejects claim values and operators that do not match the claim kind", () => {
  assert.throws(() => parseClaimSetV1({ ...claimSet, claims: [{ ...claimSet.claims[1], operator: "EQ" }] }), {
    message: "INVALID_CLAIM_SET"
  });
  assert.throws(() => parseClaimSetV1({ ...claimSet, claims: [{ claimId: "quantity", kind: "QUANTITY_EXACT", humanText: "Two", operator: "EQ", value: 1.5, overridePolicy: "NEVER" }] }), {
    message: "INVALID_CLAIM_SET"
  });
  assert.throws(() => parseClaimSetV1({ ...claimSet, claims: [{ ...claimSet.claims[0], value: "true" }] }), {
    message: "INVALID_CLAIM_SET"
  });
  assert.throws(() => parseClaimSetV1({ ...claimSet, claims: [{ claimId: "delivery", kind: "TEMPORAL_MAX", humanText: "By date", operator: "BEFORE_OR_AT", value: "tomorrow", overridePolicy: "NEVER" }] }), {
    message: "INVALID_CLAIM_SET"
  });
});
