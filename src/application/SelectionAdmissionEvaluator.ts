import canonicalize from "canonicalize";
import { parseSubmitSelectionRequest } from "../api/contracts.js";
import { parseClaimSetV1 } from "../api/ClaimSetValidation.js";
import { validateSemanticAttestation } from "../attestor/AttestationValidation.js";
import { hashCartBinding } from "../binding/CartBindingV1.js";
import { hashEvidenceSet } from "../bundle/EvidenceSet.js";
import { sha256 } from "../domain/Hash.js";
import type {
  ClaimSetV1,
  EvidenceManifestV1,
  MerchantEvidenceV1,
  SemanticAttestationV1,
  Sha256
} from "../domain/types.js";
import type { MerchantAdapter, ResolvedSelection } from "../ports/MerchantAdapter.js";
import type { AttestorConfig, SemanticAttestor } from "../ports/SemanticAttestor.js";
import { evaluateAdmission, type AdmissionOutcome, type ClaimEvaluation, type AdmissionPolicyOptions } from "../policy/AdmissionPolicy.js";
import { evaluateDeterministicClaim } from "../policy/DeterministicClaimEvaluator.js";
import { assessEvidenceManifest } from "../policy/EvidenceManifestPolicy.js";

export interface SelectionAdmissionDependencies {
  loadClaimSet(claimSetId: string): Promise<{ claimSet: ClaimSetV1; claimSetHash: Sha256 }>;
  verifyBuyerSignature(claimSet: ClaimSetV1): Promise<boolean>;
  merchant: MerchantAdapter;
  getManifest(evidenceProfileId: string): EvidenceManifestV1;
  getAttestorConfig(evidenceProfileId: string): AttestorConfig;
  attestor: SemanticAttestor;
  now?: () => Date;
  newId: () => string;
  /** May be async (ES256 verification is). Overrides are only evaluated in the STEP-UP decision route. */
  verifyOverride?: (override: Parameters<NonNullable<AdmissionPolicyOptions["verifyOverride"]>>[0]) => boolean | Promise<boolean>;
}

export type SelectionAdmissionResult =
  | { outcome: { status: "BLOCK"; reason: string } }
  | {
      outcome: AdmissionOutcome;
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
    };

interface SemanticClaimEvidence {
  manifest: EvidenceManifestV1;
  evidence: MerchantEvidenceV1[];
  complete: boolean;
  evidenceSetHash: Sha256;
  attestation?: SemanticAttestationV1;
  attestationHash?: Sha256;
}

export async function evaluateSelectionAdmission(
  input: unknown,
  dependencies: SelectionAdmissionDependencies
): Promise<SelectionAdmissionResult> {
  const selectionInput = parseSubmitSelectionRequest(input);
  const loaded = await dependencies.loadClaimSet(selectionInput.claimSetId);
  const claimSet = parseClaimSetV1(loaded.claimSet);
  const claimSetJson = canonicalize(claimSet);
  if (claimSet.claimSetId !== selectionInput.claimSetId || claimSetJson === undefined ||
      await sha256(claimSetJson) !== loaded.claimSetHash) return { outcome: { status: "BLOCK", reason: "CLAIM_SET_INTEGRITY_FAILURE" } };

  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) return { outcome: { status: "BLOCK", reason: "INVALID_POLICY_TIME" } };
  const nowIso = now.toISOString();
  const createdAt = Date.parse(claimSet.createdAt);
  const expiresAt = Date.parse(claimSet.expiresAt);
  let signatureValid = false;
  try {
    signatureValid = Boolean(claimSet.buyerSignature) && await dependencies.verifyBuyerSignature(claimSet);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return { outcome: { status: "BLOCK", reason: "CLAIM_SET_SIGNATURE_INVALID" } };
  }
  if (!Number.isFinite(createdAt) || createdAt > now.getTime() || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { outcome: { status: "BLOCK", reason: "CLAIM_SET_EXPIRED" } };
  }

  const resolved = await dependencies.merchant.resolveSelection(selectionInput);
  if (resolved.subjectRef !== selectionInput.subjectRef || !/^sha256:[0-9a-f]{64}$/.test(resolved.subjectHash) ||
      !resolved.cartBinding || !Array.isArray(resolved.cartBinding.items) || await hashCartBinding(resolved.cartBinding) !== resolved.cartSnapshotHash ||
      resolved.cartBinding.items.length !== 1 ||
      resolved.cartBinding.items[0]?.quantity !== String(selectionInput.quantity)) {
    return { outcome: { status: "BLOCK", reason: "PROVENANCE_FAILURE" } };
  }

  const emptyEvidenceSetHash = await hashEvidenceSet([]);
  const semanticEvidence = new Map<string, SemanticClaimEvidence>();
  for (const claim of claimSet.claims) {
    if (claim.kind !== "SEMANTIC_BOOLEAN" && claim.kind !== "SEMANTIC_TEXT") continue;
    if (!claim.evidenceProfileId) return { outcome: { status: "BLOCK", reason: "INVALID_EVIDENCE_PROFILE" } };
    const manifest = dependencies.getManifest(claim.evidenceProfileId);
    if (manifest.evidenceProfileId !== claim.evidenceProfileId) return { outcome: { status: "BLOCK", reason: "INVALID_EVIDENCE_PROFILE" } };
    const evidence = await dependencies.merchant.fetchEvidence({
      subjectRef: resolved.subjectRef,
      manifest,
      sessionId: dependencies.newId()
    });
    if (!Array.isArray(evidence) || evidence.some((item) => !item || item.subjectRef !== resolved.subjectRef)) {
      return { outcome: { status: "BLOCK", reason: "PROVENANCE_FAILURE" } };
    }
    // Freshness is judged at assessment time, after retrieval. Using the admission start time made evidence
    // retrieved a few milliseconds later look "from the future", so semantic claims never reached the attestor (F3).
    const assessedAt = dependencies.now?.() ?? new Date();
    if (!Number.isFinite(assessedAt.getTime()) || assessedAt.getTime() < now.getTime()) {
      return { outcome: { status: "BLOCK", reason: "INVALID_POLICY_TIME" } };
    }
    const assessment = assessEvidenceManifest(evidence, manifest, assessedAt.toISOString());
    const evidenceSetHash = await hashEvidenceSet(evidence);
    const result: SemanticClaimEvidence = {
      manifest,
      evidence,
      complete: assessment.complete,
      evidenceSetHash
    };

    if (assessment.complete) {
      const config = dependencies.getAttestorConfig(claim.evidenceProfileId);
      try {
        const rawAttestation = await dependencies.attestor.attest({
          claimSetHash: loaded.claimSetHash,
          claim,
          subjectHash: resolved.subjectHash,
          manifest,
          evidence,
          config
        });
        result.attestation = validateSemanticAttestation(rawAttestation, {
          claimId: claim.claimId,
          subjectHash: resolved.subjectHash,
          evidenceSetHash,
          evidence,
          config
        });
        const serialized = canonicalize(result.attestation);
        if (serialized !== undefined) result.attestationHash = await sha256(serialized);
      } catch {
        // A failed attestor result stays unproven and can only reach policy STEP-UP.
      }
    }
    semanticEvidence.set(claim.claimId, result);
  }

  const evaluations: ClaimEvaluation[] = [];
  for (const claim of claimSet.claims) {
    const semantic = semanticEvidence.get(claim.claimId);
    const evidenceSetHash = semantic?.evidenceSetHash ?? emptyEvidenceSetHash;
    evaluations.push({
      claim,
      deterministicSatisfied: semantic ? true : evaluateDeterministicClaim(claim, resolved, selectionInput.variantRef) ?? false,
      integrityValid: true,
      provenanceValid: true,
      evidenceComplete: semantic?.complete ?? true,
      ...(semantic ? { evidenceManifest: semantic.manifest, evidence: semantic.evidence } : {}),
      claimSetHash: loaded.claimSetHash,
      subjectRef: resolved.subjectRef,
      subjectHash: resolved.subjectHash,
      evidenceSetHash,
      ...(semantic?.attestation ? { attestation: semantic.attestation } : {}),
      ...(semantic?.attestationHash ? { attestationHash: semantic.attestationHash } : {})
    });
  }

  // No buyer override exists at selection time; overrides are verified in the STEP-UP decision route.
  const options: AdmissionPolicyOptions = { now: nowIso };
  const profiles = [...new Set([...semanticEvidence.values()].map((value) => value.manifest.evidenceProfileId))];
  if (profiles.length > 1) return { outcome: { status: "BLOCK", reason: "MULTIPLE_EVIDENCE_PROFILES_UNSUPPORTED" } };
  return {
    outcome: evaluateAdmission(evaluations, options),
    claimSet,
    claimSetHash: loaded.claimSetHash,
    resolvedSelection: resolved,
    claimEvaluations: evaluations,
    admissionEvidence: {
      evidenceManifestVersion: profiles[0] ?? "none",
      evidenceSetHashes: [...new Set([...semanticEvidence.values()].map((value) => value.evidenceSetHash))].sort(),
      attestationHashes: [...new Set([...semanticEvidence.values()].flatMap((value) => value.attestationHash ? [value.attestationHash] : []))].sort(),
      overrideHashes: []
    }
  };
}
