import type {
  BuyerOverrideV1,
  CommerceClaim,
  EvidenceManifestV1,
  MerchantEvidenceV1,
  SemanticAttestationV1,
  Sha256
} from "../domain/types.js";
import { evaluateSourceAuthority } from "./SourceAuthorityPolicy.js";

export type AdmissionOutcome =
  | { status: "ALLOW" }
  | { status: "STEP_UP"; claimIds: string[] }
  | { status: "BLOCK"; reason: string };

export interface ClaimEvaluation {
  claim: CommerceClaim;
  deterministicSatisfied?: boolean;
  integrityValid: boolean;
  provenanceValid: boolean;
  evidenceComplete: boolean;
  evidenceManifest?: EvidenceManifestV1;
  evidence?: MerchantEvidenceV1[];
  claimSetHash: Sha256;
  subjectRef: string;
  subjectHash: Sha256;
  evidenceSetHash: Sha256;
  attestationHash?: Sha256;
  attestation?: SemanticAttestationV1;
  override?: BuyerOverrideV1;
}

export interface AdmissionPolicyOptions {
  now?: string;
  /** Signature verification is supplied by the trusted service, never by the agent. */
  verifyOverride?: (override: BuyerOverrideV1) => boolean;
}

const semanticKinds = new Set<CommerceClaim["kind"]>(["SEMANTIC_BOOLEAN", "SEMANTIC_TEXT"]);

export function evaluateAdmission(
  evaluations: ClaimEvaluation[],
  options: AdmissionPolicyOptions = {}
): AdmissionOutcome {
  if (!Array.isArray(evaluations) || evaluations.length === 0) {
    return { status: "BLOCK", reason: "INVALID_EVALUATION_SET" };
  }

  const ids = evaluations.map((evaluation) => evaluation?.claim?.claimId);
  if (ids.some((id) => typeof id !== "string" || id.length === 0) || new Set(ids).size !== ids.length) {
    return { status: "BLOCK", reason: "INVALID_EVALUATION_SET" };
  }

  const now = Date.parse(options.now ?? new Date().toISOString());
  if (!Number.isFinite(now)) return { status: "BLOCK", reason: "INVALID_POLICY_TIME" };

  const stepUpClaimIds: string[] = [];
  for (const evaluation of evaluations) {
    const { claim } = evaluation;
    if (evaluation.integrityValid !== true) return { status: "BLOCK", reason: "INTEGRITY_FAILURE" };
    if (evaluation.provenanceValid !== true) return { status: "BLOCK", reason: "PROVENANCE_FAILURE" };

    const semantic = semanticKinds.has(claim.kind);
    if (claim.overridePolicy === "HUMAN_EXACT_SUBJECT" && !semantic) {
      return { status: "BLOCK", reason: "NON_SEMANTIC_OVERRIDE_POLICY" };
    }

    if (!semantic) {
      if (evaluation.deterministicSatisfied !== true) {
        return { status: "BLOCK", reason: "NON_RELAXABLE_CLAIM_FAILED" };
      }
      if (evaluation.override) return { status: "BLOCK", reason: "OVERRIDE_NOT_ALLOWED" };
      continue;
    }

    if (evaluation.deterministicSatisfied === false) {
      return { status: "BLOCK", reason: "NON_RELAXABLE_CLAIM_FAILED" };
    }

    if (evaluation.attestation && !attestationMatches(evaluation, evaluation.attestation)) {
      return { status: "BLOCK", reason: "ATTESTATION_BINDING_MISMATCH" };
    }

    let sourceAuthorityNeedsStepUp = false;
    if (evaluation.attestation) {
      if (!evaluation.evidenceManifest || !evaluation.evidence) {
        return { status: "BLOCK", reason: "SOURCE_AUTHORITY_FAILURE" };
      }
      const sourceOutcome = evaluateSourceAuthority(evaluation.attestation, evaluation.evidenceManifest, evaluation.evidence);
      if (sourceOutcome === "BLOCK") return { status: "BLOCK", reason: "SOURCE_AUTHORITY_FAILURE" };
      sourceAuthorityNeedsStepUp = sourceOutcome === "STEP_UP";
    }

    if (evaluation.override) {
      if (claim.overridePolicy !== "HUMAN_EXACT_SUBJECT" ||
          (!isRelaxableFailure(evaluation) && !sourceAuthorityNeedsStepUp) ||
          !validOverride(evaluation, options.verifyOverride, now)) {
        return { status: "BLOCK", reason: "INVALID_OVERRIDE" };
      }
      continue;
    }

    if (claim.overridePolicy !== "HUMAN_EXACT_SUBJECT") {
      if (!evaluation.evidenceComplete || !evaluation.attestation || evaluation.attestation.result !== "SUPPORTED") {
        return { status: "BLOCK", reason: "NON_RELAXABLE_SEMANTIC_CLAIM_FAILED" };
      }
      continue;
    }

    if (!evaluation.evidenceComplete || !evaluation.attestation || evaluation.attestation.result !== "SUPPORTED" || sourceAuthorityNeedsStepUp) {
      stepUpClaimIds.push(claim.claimId);
    }
  }

  return stepUpClaimIds.length > 0
    ? { status: "STEP_UP", claimIds: stepUpClaimIds.sort() }
    : { status: "ALLOW" };
}

function attestationMatches(evaluation: ClaimEvaluation, attestation: SemanticAttestationV1): boolean {
  return attestation.claimId === evaluation.claim.claimId &&
    attestation.subjectHash === evaluation.subjectHash &&
    attestation.evidenceSetHash === evaluation.evidenceSetHash;
}

function isRelaxableFailure(evaluation: ClaimEvaluation): boolean {
  return semanticKinds.has(evaluation.claim.kind) &&
    (!evaluation.evidenceComplete || !evaluation.attestation || evaluation.attestation.result !== "SUPPORTED");
}

function validOverride(
  evaluation: ClaimEvaluation,
  verifyOverride: AdmissionPolicyOptions["verifyOverride"],
  now: number
): boolean {
  const override = evaluation.override;
  const attestation = evaluation.attestation;
  if (!override || !attestation || !evaluation.attestationHash || !verifyOverride) return false;
  if (override.schemaVersion !== "buyer-override-v1" || override.decision !== "ACCEPT_EXCEPTION") return false;
  if (!override.nonce || !override.buyerSignature || override.buyerSignature.alg !== "ES256") return false;
  if (override.claimId !== evaluation.claim.claimId || override.claimSetHash !== evaluation.claimSetHash) return false;
  if (override.subjectRef !== evaluation.subjectRef || override.subjectHash !== evaluation.subjectHash) return false;
  if (override.evidenceSetHash !== evaluation.evidenceSetHash || override.attestationHash !== evaluation.attestationHash) return false;
  const expiresAt = Date.parse(override.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  try {
    return verifyOverride(override) === true;
  } catch {
    return false;
  }
}
