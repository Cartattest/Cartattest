import canonicalize from "canonicalize";
import { sha256 } from "../domain/Hash.js";
import type { MerchantEvidenceV1, Sha256 } from "../domain/types.js";

export async function hashEvidenceSet(evidence: MerchantEvidenceV1[]): Promise<Sha256> {
  if (!Array.isArray(evidence)) throw new Error("INVALID_EVIDENCE_SET");
  const evidenceIds = new Set<string>();
  for (const item of evidence) {
    if (!item || typeof item.evidenceId !== "string" || !item.evidenceId) throw new Error("EVIDENCE_INTEGRITY_FAILURE");
    if (evidenceIds.has(item.evidenceId)) throw new Error("DUPLICATE_EVIDENCE_ID");
    evidenceIds.add(item.evidenceId);
    if (typeof item.rawContent !== "string" || typeof item.modelView !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(item.rawHash) || !/^sha256:[0-9a-f]{64}$/.test(item.modelViewHash) ||
        await sha256(item.rawContent) !== item.rawHash || await sha256(item.modelView) !== item.modelViewHash) {
      throw new Error("EVIDENCE_INTEGRITY_FAILURE");
    }
  }

  const canonical = canonicalize([...evidence].sort((left, right) =>
    left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0
  ));
  if (canonical === undefined) throw new Error("INVALID_EVIDENCE_SET");
  return sha256(canonical);
}
