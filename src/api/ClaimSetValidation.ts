import type { ClaimSetV1, CommerceClaim, Es256Signature } from "../domain/types.js";

const claimKinds: CommerceClaim["kind"][] = [
  "BUDGET_MAX", "MERCHANT_EXACT", "SKU_EXACT", "VARIANT_EXACT", "QUANTITY_EXACT",
  "CURRENCY_EXACT", "TEMPORAL_MAX", "SEMANTIC_BOOLEAN", "SEMANTIC_TEXT"
];
const operators: CommerceClaim["operator"][] = ["EQ", "LTE", "GTE", "BEFORE_OR_AT", "SUPPORTED"];
const overridePolicies: CommerceClaim["overridePolicy"][] = ["NEVER", "HUMAN_EXACT_SUBJECT"];
const claimKeys = ["claimId", "kind", "humanText", "operator", "value", "currency", "evidenceProfileId", "overridePolicy"];

export function parseClaimSetV1(value: unknown): ClaimSetV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, ["schemaVersion", "claimSetId", "buyerRequestText", "claims", "createdAt", "expiresAt", "buyerSignature"]) ||
      value.schemaVersion !== "claim-set-v1" || !nonempty(value.claimSetId) || !nonempty(value.buyerRequestText) ||
      !Array.isArray(value.claims) || value.claims.length === 0 || typeof value.createdAt !== "string" || typeof value.expiresAt !== "string") {
    throw new Error("INVALID_CLAIM_SET");
  }

  const createdAt = Date.parse(value.createdAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt) throw new Error("INVALID_CLAIM_SET");

  const claims = value.claims.map(parseClaim);
  if (new Set(claims.map((claim) => claim.claimId)).size !== claims.length) throw new Error("INVALID_CLAIM_SET");

  const result: ClaimSetV1 = {
    schemaVersion: "claim-set-v1",
    claimSetId: value.claimSetId,
    buyerRequestText: value.buyerRequestText,
    claims,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    ...(value.buyerSignature === undefined ? {} : { buyerSignature: parseSignature(value.buyerSignature) })
  };
  return result;
}

function parseClaim(value: unknown): CommerceClaim {
  if (!isRecord(value) || !hasOnlyKeys(value, claimKeys) ||
      !nonempty(value.claimId) || !claimKinds.includes(value.kind as CommerceClaim["kind"]) ||
      !nonempty(value.humanText) ||
      (value.operator !== undefined && !operators.includes(value.operator as CommerceClaim["operator"])) ||
      !isClaimValue(value.value) ||
      (value.currency !== undefined && (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency))) ||
      (value.evidenceProfileId !== undefined && typeof value.evidenceProfileId !== "string") ||
      !overridePolicies.includes(value.overridePolicy as CommerceClaim["overridePolicy"])) {
    throw new Error("INVALID_CLAIM_SET");
  }

  const kind = value.kind as CommerceClaim["kind"];
  const overridePolicy = value.overridePolicy as CommerceClaim["overridePolicy"];
  const operator = (value.operator ?? "SUPPORTED") as CommerceClaim["operator"];
  if (overridePolicy === "HUMAN_EXACT_SUBJECT" && kind !== "SEMANTIC_BOOLEAN" && kind !== "SEMANTIC_TEXT") {
    throw new Error("INVALID_CLAIM_SET");
  }
  if (!validClaimSemantics(kind, operator, value.value, value.currency, value.evidenceProfileId)) throw new Error("INVALID_CLAIM_SET");

  return {
    claimId: value.claimId,
    kind,
    humanText: value.humanText,
    operator,
    value: value.value as string | number | boolean,
    ...(value.currency === undefined ? {} : { currency: value.currency as string }),
    ...(value.evidenceProfileId === undefined ? {} : { evidenceProfileId: value.evidenceProfileId as string }),
    overridePolicy
  };
}

function validClaimSemantics(
  kind: CommerceClaim["kind"],
  operator: CommerceClaim["operator"],
  value: unknown,
  currency: unknown,
  evidenceProfileId: unknown
): boolean {
  switch (kind) {
    case "BUDGET_MAX":
      return operator === "LTE" && typeof value === "number" && value >= 0 && currency !== undefined;
    case "MERCHANT_EXACT":
    case "SKU_EXACT":
    case "VARIANT_EXACT":
      return operator === "EQ" && nonempty(value) && evidenceProfileId === undefined;
    case "QUANTITY_EXACT":
      return operator === "EQ" && typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && evidenceProfileId === undefined;
    case "CURRENCY_EXACT":
      return operator === "EQ" && typeof value === "string" && /^[A-Z]{3}$/.test(value) && evidenceProfileId === undefined;
    case "TEMPORAL_MAX":
      return operator === "BEFORE_OR_AT" && validDateTime(value) && evidenceProfileId === undefined;
    case "SEMANTIC_BOOLEAN":
      return operator === "SUPPORTED" && typeof value === "boolean" && nonempty(evidenceProfileId);
    case "SEMANTIC_TEXT":
      return operator === "SUPPORTED" && nonempty(value) && nonempty(evidenceProfileId);
  }
}

function validDateTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function parseSignature(value: unknown): Es256Signature {
  if (!isRecord(value) || !hasOnlyKeys(value, ["alg", "keyId", "signatureB64"]) || value.alg !== "ES256" ||
      !nonempty(value.keyId) || !nonempty(value.signatureB64)) {
    throw new Error("INVALID_CLAIM_SET");
  }
  return { alg: "ES256", keyId: value.keyId, signatureB64: value.signatureB64 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isClaimValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}
