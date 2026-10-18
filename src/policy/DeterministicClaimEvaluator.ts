import type { CommerceClaim } from "../domain/types.js";
import type { ResolvedSelection } from "../ports/MerchantAdapter.js";

export function evaluateDeterministicClaim(
  claim: CommerceClaim,
  selection: Pick<ResolvedSelection, "cartBinding">,
  variantRef: string
): boolean | undefined {
  const binding = selection?.cartBinding;
  if (!binding) return false;
  switch (claim.kind) {
    case "BUDGET_MAX": {
      if (claim.operator !== "LTE" || claim.currency !== binding.currency) return false;
      const total = minorUnits(binding.amountBreakdown?.total);
      const budget = minorUnits(claim.value);
      return total !== undefined && budget !== undefined && total <= budget;
    }
    case "MERCHANT_EXACT":
      return claim.operator === "EQ" && typeof claim.value === "string" && claim.value === binding.payee?.identityValue;
    case "SKU_EXACT":
      return claim.operator === "EQ" && typeof claim.value === "string" && binding.items?.length === 1 && claim.value === binding.items[0]?.sku;
    case "VARIANT_EXACT":
      return claim.operator === "EQ" && typeof claim.value === "string" && claim.value === variantRef;
    case "QUANTITY_EXACT":
      return claim.operator === "EQ" && typeof claim.value === "number" && Number.isSafeInteger(claim.value) &&
        binding.items?.length === 1 && binding.items[0]?.quantity === String(claim.value);
    case "CURRENCY_EXACT":
      return claim.operator === "EQ" && typeof claim.value === "string" && claim.value === binding.currency;
    case "TEMPORAL_MAX":
      return false;
    case "SEMANTIC_BOOLEAN":
    case "SEMANTIC_TEXT":
      return undefined;
  }
}

function minorUnits(value: unknown): bigint | undefined {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" && typeof text !== "number") return undefined;
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(String(text));
  if (!match) return undefined;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}
