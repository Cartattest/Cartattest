import type { BundleSealV1, Sha256 } from "../domain/types.js";

export interface BundleRecord {
  index: number;
  recordType: string;
  payload: unknown;
  payloadHash: Sha256;
  previousEventHash: Sha256 | null;
  keyId: string;
  signatureB64: string;
}

export interface EvidenceBundleV1 {
  schemaVersion: "evidence-bundle-v1";
  bundleId: string;
  records: BundleRecord[];
  seal: BundleSealV1;
}

/**
 * Offline verification MUST obtain the trusted CartAttest service public key from outside the bundle
 * (repo/config/CLI argument or other pinned distribution channel). Never trust a key embedded only in the bundle.
 */
export function verifyBundleShape(bundle: EvidenceBundleV1): void {
  if (bundle.seal.recordCount !== bundle.records.length) throw new Error("BUNDLE_TRUNCATED_OR_COUNT_MISMATCH");
  if (bundle.records.length === 0) throw new Error("EMPTY_BUNDLE");
  // Builder TODO: verify record hash chain, JCS payload hashes, ES256 signatures, terminalEventHash and semantic cross-record bindings.
}
