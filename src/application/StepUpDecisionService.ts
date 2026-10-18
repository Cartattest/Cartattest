import canonicalize from "canonicalize";
import type { BuyerOverrideV1, ClaimSetV1, Sha256 } from "../domain/types.js";
import { sha256 } from "../domain/Hash.js";
import { evaluateAdmission, type AdmissionOutcome, type AdmissionPolicyOptions, type ClaimEvaluation } from "../policy/AdmissionPolicy.js";
import type { ResolvedSelection } from "../ports/MerchantAdapter.js";

export interface StepUpContextV1 {
  schemaVersion: "step-up-context-v1";
  claimIds: string[];
  expiresAt: string;
  claimSet: ClaimSetV1;
  claimSetHash: Sha256;
  resolvedSelection: ResolvedSelection;
  claimEvaluations: ClaimEvaluation[];
  admissionEvidence: {
    evidenceManifestVersion: string;
    evidenceSetHashes: Sha256[];
    attestationHashes: Sha256[];
    overrideHashes: Sha256[];
  };
}

export interface StepUpDecisionResult {
  outcome: AdmissionOutcome;
  claimSet: ClaimSetV1;
  claimSetHash: Sha256;
  resolvedSelection: ResolvedSelection;
  claimEvaluations: ClaimEvaluation[];
  admissionEvidence: StepUpContextV1["admissionEvidence"];
}

export async function evaluateStepUpDecision(
  context: StepUpContextV1,
  overrides: BuyerOverrideV1[],
  options: AdmissionPolicyOptions
): Promise<StepUpDecisionResult> {
  if (!Array.isArray(overrides) || new Set(overrides.map((override) => override.claimId)).size !== overrides.length ||
      overrides.some((override) => !context.claimIds.includes(override.claimId))) {
    return { ...context, outcome: { status: "BLOCK", reason: "INVALID_OVERRIDE" } };
  }

  const byClaimId = new Map(overrides.map((override) => [override.claimId, override]));
  const claimEvaluations = context.claimEvaluations.map((evaluation) => {
    const override = byClaimId.get(evaluation.claim.claimId);
    return override ? { ...evaluation, override } : evaluation;
  });
  const outcome = evaluateAdmission(claimEvaluations, options);
  const overrideHashes: Sha256[] = [];
  if (outcome.status === "ALLOW") {
    for (const override of overrides) {
      const serialized = canonicalize(override);
      if (serialized === undefined) return { ...context, claimEvaluations, outcome: { status: "BLOCK", reason: "INVALID_OVERRIDE" } };
      overrideHashes.push(await sha256(serialized));
    }
  }

  return {
    ...context,
    claimEvaluations,
    outcome,
    admissionEvidence: {
      ...context.admissionEvidence,
      overrideHashes: outcome.status === "ALLOW" ? [...overrideHashes].sort() : context.admissionEvidence.overrideHashes
    }
  };
}
