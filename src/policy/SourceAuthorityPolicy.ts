import type { EvidenceManifestV1, MerchantEvidenceV1, SemanticAttestationV1 } from "../domain/types.js";
import { validateEvidenceManifest } from "./EvidenceManifestPolicy.js";

export type SourceAuthorityOutcome = "ALLOW" | "STEP_UP" | "BLOCK";

export function evaluateSourceAuthority(
  attestation: Pick<SemanticAttestationV1, "result" | "supportQuotes" | "contradictionQuotes">,
  manifest: EvidenceManifestV1,
  evidence: MerchantEvidenceV1[]
): SourceAuthorityOutcome {
  if (!attestation || !manifest || !Array.isArray(evidence) || !Array.isArray(manifest.sourceAuthority) ||
      !Array.isArray(manifest.admissibleSourceClasses) ||
      (manifest.contradictionPolicy !== "BLOCK_EQUAL_OR_HIGHER_AUTHORITY" &&
       manifest.contradictionPolicy !== "STEP_UP_ON_EQUAL_OR_HIGHER_AUTHORITY")) return "BLOCK";
  try {
    validateEvidenceManifest(manifest);
  } catch {
    return "BLOCK";
  }

  const authority = new Map(manifest.sourceAuthority.map((rule) => [rule?.sourceClass, rule]));
  const admissible = new Set(manifest.admissibleSourceClasses);
  const byId = new Map<string, MerchantEvidenceV1>();
  for (const item of evidence) {
    if (!item || typeof item.evidenceId !== "string" || !item.evidenceId || byId.has(item.evidenceId)) return "BLOCK";
    byId.set(item.evidenceId, item);
  }

  const rank = (quotes: unknown, flag: "maySatisfy" | "mayBlockIfContradictory"): number | undefined => {
    if (!Array.isArray(quotes)) throw new Error("INVALID_QUOTES");
    let highest: number | undefined;
    for (const quote of quotes) {
      if (!quote || typeof quote.evidenceId !== "string" || typeof quote.verbatim !== "string" || !quote.verbatim) {
        throw new Error("INVALID_QUOTE");
      }
      const source = byId.get(quote.evidenceId);
      if (!source || !admissible.has(source.sourceClass)) throw new Error("UNKNOWN_EVIDENCE");
      const rule = authority.get(source.sourceClass);
      if (!rule || !Number.isInteger(rule.rank) || rule.rank < 0 || rule.rank > 100 ||
          typeof rule[flag] !== "boolean" || typeof rule.maySatisfy !== "boolean" ||
          typeof rule.mayBlockIfContradictory !== "boolean") throw new Error("INVALID_AUTHORITY");
      if (rule[flag]) highest = Math.max(highest ?? -1, rule.rank);
    }
    return highest;
  };

  try {
    const supportRank = rank(attestation.supportQuotes, "maySatisfy");
    const contradictionRank = rank(attestation.contradictionQuotes, "mayBlockIfContradictory");
    if (contradictionRank !== undefined && contradictionRank >= (supportRank ?? -1)) {
      return manifest.contradictionPolicy === "BLOCK_EQUAL_OR_HIGHER_AUTHORITY" ? "BLOCK" : "STEP_UP";
    }
    if (attestation.result !== "SUPPORTED" || supportRank === undefined) return "STEP_UP";
    return "ALLOW";
  } catch {
    return "BLOCK";
  }
}
