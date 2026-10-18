import type { CommerceClaim, EvidenceManifestV1, MerchantEvidenceV1, SemanticAttestationV1 } from "../domain/types.js";

export interface AttestorConfig {
  provider: string;
  modelId: string;
  temperature: 0;
  topP: 1;
  maxOutputTokens: number;
  promptHash: `sha256:${string}`;
  configHash: `sha256:${string}`;
  attestorVersion: string;
}

export interface SemanticAttestor {
  /**
   * One valid result per claim/subject/evidence/config tuple.
   * The implementation MUST memoize the valid result and MUST NOT reroll identical state.
   * Invalid/schema-violating model output fails closed as UNPROVEN after transport policy is exhausted.
   */
  attest(args: {
    claim: CommerceClaim;
    subjectHash: `sha256:${string}`;
    manifest: EvidenceManifestV1;
    evidence: MerchantEvidenceV1[];
    config: AttestorConfig;
  }): Promise<SemanticAttestationV1>;
}
