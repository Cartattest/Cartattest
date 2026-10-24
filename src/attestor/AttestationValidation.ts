import type { AttestorConfig } from "../ports/SemanticAttestor.js";
import type { MerchantEvidenceV1, SemanticAttestationV1, Sha256 } from "../domain/types.js";

export interface AttestationValidationContext {
  claimId: string;
  subjectHash: Sha256;
  evidenceSetHash: Sha256;
  evidence: MerchantEvidenceV1[];
  config: AttestorConfig;
}

const attestationKeys = [
  "schemaVersion", "attestationId", "claimId", "subjectHash", "evidenceSetHash", "evidenceHashes", "result",
  "supportQuotes", "contradictionQuotes", "modelId", "attestorVersion", "promptHash", "configHash", "createdAt"
];

export function validateSemanticAttestation(value: unknown, context: AttestationValidationContext): SemanticAttestationV1 {
  if (!isRecord(value) || !hasExactKeys(value, attestationKeys) ||
      value.schemaVersion !== "semantic-attestation-v1" || !nonempty(value.attestationId) ||
      value.claimId !== context.claimId || value.subjectHash !== context.subjectHash ||
      value.evidenceSetHash !== context.evidenceSetHash || !isHash(value.subjectHash) || !isHash(value.evidenceSetHash) ||
      !Array.isArray(value.evidenceHashes) || value.evidenceHashes.some((hash) => !isHash(hash)) ||
      !["SUPPORTED", "CONTRADICTED", "UNPROVEN"].includes(String(value.result)) ||
      !Array.isArray(value.supportQuotes) || !Array.isArray(value.contradictionQuotes) ||
      value.modelId !== context.config.modelId || value.attestorVersion !== context.config.attestorVersion ||
      value.promptHash !== context.config.promptHash || value.configHash !== context.config.configHash ||
      !isHash(value.promptHash) || !isHash(value.configHash) || !nonempty(value.modelId) ||
      !nonempty(value.attestorVersion) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error("INVALID_SEMANTIC_ATTESTATION");
  }

  const evidenceById = new Map(context.evidence.map((item) => [item.evidenceId, item]));
  if (evidenceById.size !== context.evidence.length) throw new Error("INVALID_SEMANTIC_ATTESTATION");
  const evidenceHashes = new Set(context.evidence.flatMap((item) => [item.rawHash, item.modelViewHash]));
  if (new Set(value.evidenceHashes).size !== value.evidenceHashes.length ||
      value.evidenceHashes.some((hash) => !evidenceHashes.has(hash as Sha256))) {
    throw new Error("INVALID_SEMANTIC_ATTESTATION");
  }

  const supportQuotes = parseQuotes(value.supportQuotes, evidenceById);
  const contradictionQuotes = parseQuotes(value.contradictionQuotes, evidenceById);
  if ((value.result === "SUPPORTED" && supportQuotes.length === 0) ||
      (value.result === "CONTRADICTED" && contradictionQuotes.length === 0)) {
    throw new Error("INVALID_SEMANTIC_ATTESTATION");
  }

  return {
    schemaVersion: "semantic-attestation-v1",
    attestationId: value.attestationId,
    claimId: value.claimId,
    subjectHash: value.subjectHash as Sha256,
    evidenceSetHash: value.evidenceSetHash as Sha256,
    evidenceHashes: value.evidenceHashes as Sha256[],
    result: value.result as SemanticAttestationV1["result"],
    supportQuotes,
    contradictionQuotes,
    modelId: value.modelId,
    attestorVersion: value.attestorVersion,
    promptHash: value.promptHash as Sha256,
    configHash: value.configHash as Sha256,
    createdAt: value.createdAt
  };
}

function parseQuotes(value: unknown[], evidence: Map<string, MerchantEvidenceV1>): SemanticAttestationV1["supportQuotes"] {
  return value.map((quote) => {
    if (!isRecord(quote) || !hasExactKeys(quote, ["evidenceId", "verbatim"]) ||
        !nonempty(quote.evidenceId) || !nonempty(quote.verbatim)) {
      throw new Error("INVALID_SEMANTIC_ATTESTATION");
    }
    const source = evidence.get(quote.evidenceId);
    if (!source || !source.modelView.includes(quote.verbatim)) throw new Error("INVALID_SEMANTIC_ATTESTATION");
    return { evidenceId: quote.evidenceId, verbatim: quote.verbatim };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHash(value: unknown): value is Sha256 {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
