import type { EvidenceManifestV1, MerchantEvidenceV1, SourceClass } from "../domain/types.js";

const sourceClasses: SourceClass[] = [
  "MERCHANT_STRUCTURED_ATTRIBUTE",
  "MERCHANT_TECHNICAL_SPEC",
  "MERCHANT_FULFILLMENT_PROMISE",
  "MERCHANT_TERMS",
  "MERCHANT_DESCRIPTION",
  "MERCHANT_QA",
  "CUSTOMER_REVIEW",
  "AGENT_GENERATED_SUMMARY",
  "UNKNOWN"
];

export interface EvidenceManifestAssessment {
  complete: boolean;
  missingRequiredSourceClasses: SourceClass[];
  staleEvidenceIds: string[];
  inadmissibleEvidenceIds: string[];
}

export function assessEvidenceManifest(
  evidence: MerchantEvidenceV1[],
  manifest: EvidenceManifestV1,
  now: string
): EvidenceManifestAssessment {
  assertManifest(manifest);
  if (!Array.isArray(evidence)) throw new Error("INVALID_MERCHANT_EVIDENCE");
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("INVALID_EVALUATION_TIME");

  const admissible = new Set(manifest.admissibleSourceClasses);
  const present = new Set<SourceClass>();
  const staleEvidenceIds: string[] = [];
  const inadmissibleEvidenceIds: string[] = [];

  for (const item of evidence) {
    if (!item || typeof item.evidenceId !== "string" || !item.evidenceId || !isSourceClass(item.sourceClass)) {
      throw new Error("INVALID_MERCHANT_EVIDENCE");
    }
    if (!admissible.has(item.sourceClass)) {
      inadmissibleEvidenceIds.push(item.evidenceId);
      continue;
    }

    present.add(item.sourceClass);
    const retrievedAt = Date.parse(item.retrievedAt);
    if (!Number.isFinite(retrievedAt) || retrievedAt > nowMs || nowMs - retrievedAt > manifest.freshnessSeconds * 1000) {
      staleEvidenceIds.push(item.evidenceId);
    }
  }

  const missingRequiredSourceClasses = manifest.requiredSourceClasses.filter((sourceClass) => !present.has(sourceClass));
  return {
    complete: missingRequiredSourceClasses.length === 0 && staleEvidenceIds.length === 0 && inadmissibleEvidenceIds.length === 0,
    missingRequiredSourceClasses,
    staleEvidenceIds,
    inadmissibleEvidenceIds
  };
}

function assertManifest(value: EvidenceManifestV1): void {
  if (!value || value.schemaVersion !== "evidence-manifest-v1" || !value.evidenceProfileId ||
      !Number.isInteger(value.freshnessSeconds) || value.freshnessSeconds < 1 ||
      (value.contradictionPolicy !== "BLOCK_EQUAL_OR_HIGHER_AUTHORITY" &&
       value.contradictionPolicy !== "STEP_UP_ON_EQUAL_OR_HIGHER_AUTHORITY") ||
      !Array.isArray(value.requiredSourceClasses) || !Array.isArray(value.admissibleSourceClasses) ||
      !Array.isArray(value.sourceAuthority) || value.sourceAuthority.length === 0) {
    throw new Error("INVALID_EVIDENCE_MANIFEST");
  }

  if (!validUniqueClasses(value.requiredSourceClasses) || !validUniqueClasses(value.admissibleSourceClasses) ||
      value.requiredSourceClasses.some((sourceClass) => !value.admissibleSourceClasses.includes(sourceClass))) {
    throw new Error("INVALID_EVIDENCE_MANIFEST");
  }

  const authorityClasses = new Set<SourceClass>();
  for (const rule of value.sourceAuthority) {
    if (!rule || !isSourceClass(rule.sourceClass) || authorityClasses.has(rule.sourceClass) ||
        !Number.isInteger(rule.rank) || rule.rank < 0 || rule.rank > 100 ||
        typeof rule.maySatisfy !== "boolean" || typeof rule.mayBlockIfContradictory !== "boolean") {
      throw new Error("INVALID_EVIDENCE_MANIFEST");
    }
    authorityClasses.add(rule.sourceClass);
  }
}

function validUniqueClasses(value: SourceClass[]): boolean {
  return value.every(isSourceClass) && new Set(value).size === value.length;
}

function isSourceClass(value: unknown): value is SourceClass {
  return typeof value === "string" && sourceClasses.includes(value as SourceClass);
}
