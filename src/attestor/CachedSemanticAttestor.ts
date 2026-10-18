import { hashEvidenceSet } from "../bundle/EvidenceSet.js";
import { hashAttestationCacheKey } from "./AttestationCacheKey.js";
import { validateSemanticAttestation } from "./AttestationValidation.js";
import type { SemanticAttestationV1 } from "../domain/types.js";
import type { SemanticAttestor } from "../ports/SemanticAttestor.js";

export class CachedSemanticAttestor implements SemanticAttestor {
  // shortcut: this cache is process-local; replace with durable storage before multi-instance deployment.
  private readonly pending = new Map<string, Promise<SemanticAttestationV1>>();

  constructor(private readonly attestor: SemanticAttestor, private readonly now: () => Date = () => new Date()) {}

  async attest(args: Parameters<SemanticAttestor["attest"]>[0]): Promise<SemanticAttestationV1> {
    const evidenceSetHash = await hashEvidenceSet(args.evidence);
    const cacheKey = await hashAttestationCacheKey({
      claimSetHash: args.claimSetHash,
      claimId: args.claim.claimId,
      subjectHash: args.subjectHash,
      evidenceSetHash,
      attestorConfigHash: args.config.configHash
    });
    const cached = this.pending.get(cacheKey);
    if (cached) return cached;

    const request = this.createAttestation(args, evidenceSetHash);
    this.pending.set(cacheKey, request);
    try {
      return await request;
    } catch (error) {
      if (this.pending.get(cacheKey) === request) this.pending.delete(cacheKey);
      throw error;
    }
  }

  private async createAttestation(
    args: Parameters<SemanticAttestor["attest"]>[0],
    evidenceSetHash: `sha256:${string}`
  ): Promise<SemanticAttestationV1> {
    const value = await this.attestor.attest(args);
    try {
      return validateSemanticAttestation(value, {
        claimId: args.claim.claimId,
        subjectHash: args.subjectHash,
        evidenceSetHash,
        evidence: args.evidence,
        config: args.config
      });
    } catch {
      const createdAt = this.now().toISOString();
      return {
        schemaVersion: "semantic-attestation-v1",
        attestationId: `att-${globalThis.crypto.randomUUID()}`,
        claimId: args.claim.claimId,
        subjectHash: args.subjectHash,
        evidenceSetHash,
        evidenceHashes: args.evidence.map((item) => item.rawHash),
        result: "UNPROVEN",
        supportQuotes: [],
        contradictionQuotes: [],
        modelId: args.config.modelId,
        attestorVersion: args.config.attestorVersion,
        promptHash: args.config.promptHash,
        configHash: args.config.configHash,
        createdAt
      };
    }
  }
}
