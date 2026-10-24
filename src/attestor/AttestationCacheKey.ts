import canonicalize from "canonicalize";
import { sha256 } from "../domain/Hash.js";
import type { Sha256 } from "../domain/types.js";

export interface AttestationCacheKeyInput {
  claimSetHash: Sha256;
  claimId: string;
  subjectHash: Sha256;
  evidenceSetHash: Sha256;
  attestorConfigHash: Sha256;
}

export async function hashAttestationCacheKey(value: AttestationCacheKeyInput): Promise<Sha256> {
  if (!value || !isHash(value.claimSetHash) || typeof value.claimId !== "string" || !value.claimId.trim() || !isHash(value.subjectHash) ||
      !isHash(value.evidenceSetHash) || !isHash(value.attestorConfigHash)) {
    throw new Error("INVALID_ATTESTATION_CACHE_KEY");
  }
  const canonical = canonicalize({
    claimSetHash: value.claimSetHash,
    claimId: value.claimId,
    subjectHash: value.subjectHash,
    evidenceSetHash: value.evidenceSetHash,
    attestorConfigHash: value.attestorConfigHash
  });
  if (canonical === undefined) throw new Error("INVALID_ATTESTATION_CACHE_KEY");
  return sha256(canonical);
}

function isHash(value: unknown): value is Sha256 {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
