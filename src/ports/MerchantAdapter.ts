import type { CartBindingV1, EvidenceManifestV1, MerchantEvidenceV1 } from "../domain/types.js";

export interface SelectionInput {
  claimSetId: string;
  subjectRef: string;
  variantRef: string;
  quantity: number;
  fulfillmentRef: string;
}

export interface ResolvedSelection {
  subjectRef: string;
  subjectHash: `sha256:${string}`;
  cartBinding: CartBindingV1;
  cartSnapshotHash: `sha256:${string}`;
}

export interface MerchantAdapter {
  /** Resolve authoritative merchant/cart facts. Never trust prices/terms from the agent. */
  resolveSelection(input: SelectionInput): Promise<ResolvedSelection>;

  /** Fetch the complete evidence set required by the manifest for a semantic claim. */
  fetchEvidence(args: {
    subjectRef: string;
    manifest: EvidenceManifestV1;
    sessionId: string;
  }): Promise<MerchantEvidenceV1[]>;
}
