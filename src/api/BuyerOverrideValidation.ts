import type { BuyerOverrideV1, Es256Signature, Sha256 } from "../domain/types.js";

const hashPattern = /^sha256:[0-9a-f]{64}$/;

export function parseBuyerOverrideV1(value: unknown): BuyerOverrideV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion", "overrideId", "claimSetHash", "claimId", "subjectRef", "subjectHash",
    "evidenceSetHash", "attestationHash", "decision", "expiresAt", "nonce", "buyerSignature"
  ]) || value.schemaVersion !== "buyer-override-v1" || !nonempty(value.overrideId) ||
      !validHash(value.claimSetHash) || !nonempty(value.claimId) || !nonempty(value.subjectRef) ||
      !validHash(value.subjectHash) || !validHash(value.evidenceSetHash) || !validHash(value.attestationHash) ||
      value.decision !== "ACCEPT_EXCEPTION" || !validDateTime(value.expiresAt) || !nonempty(value.nonce)) {
    throw new Error("INVALID_BUYER_OVERRIDE");
  }
  const buyerSignature = parseSignature(value.buyerSignature);
  return {
    schemaVersion: "buyer-override-v1",
    overrideId: value.overrideId,
    claimSetHash: value.claimSetHash as Sha256,
    claimId: value.claimId,
    subjectRef: value.subjectRef,
    subjectHash: value.subjectHash as Sha256,
    evidenceSetHash: value.evidenceSetHash as Sha256,
    attestationHash: value.attestationHash as Sha256,
    decision: "ACCEPT_EXCEPTION",
    expiresAt: value.expiresAt,
    nonce: value.nonce,
    buyerSignature
  };
}

function parseSignature(value: unknown): Es256Signature {
  if (!isRecord(value) || !hasOnlyKeys(value, ["alg", "keyId", "signatureB64"]) || value.alg !== "ES256" ||
      !nonempty(value.keyId) || typeof value.signatureB64 !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/.test(value.signatureB64) ||
      !hasEs256SignatureLength(value.signatureB64)) throw new Error("INVALID_BUYER_OVERRIDE");
  return { alg: "ES256", keyId: value.keyId, signatureB64: value.signatureB64 };
}

function hasEs256SignatureLength(value: string): boolean {
  try { return atob(value).length === 64; } catch { return false; }
}

function validHash(value: unknown): value is Sha256 {
  return typeof value === "string" && hashPattern.test(value);
}

function validDateTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
