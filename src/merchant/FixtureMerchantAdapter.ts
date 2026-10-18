import canonicalize from "canonicalize";
import { hashCartBinding } from "../binding/CartBindingV1.js";
import type { CartBindingV1, EvidenceManifestV1, MerchantEvidenceV1, SourceClass } from "../domain/types.js";
import type { MerchantAdapter, ResolvedSelection, SelectionInput } from "../ports/MerchantAdapter.js";

interface FixtureCatalogue {
  merchant: {
    payee: { identityType: "MERCHANT_ID" | "EMAIL"; identityValue: string };
  };
  fulfillments: Array<{
    fulfillmentRef: string;
    shipping: Omit<CartBindingV1["shipping"], "preference">;
  }>;
  products: Array<{
    subjectRef: string;
    name: string;
    variants: Array<{
      variantRef: string;
      sku: string;
      currency: string;
      unitAmount: string;
      tax: string;
    }>;
    evidenceFields: Array<{ fieldId: string; sourceClass: SourceClass; content: string }>;
  }>;
}

export class FixtureMerchantAdapter implements MerchantAdapter {
  constructor(private readonly catalogue: FixtureCatalogue, private readonly now: () => Date = () => new Date()) {}

  async resolveSelection(input: SelectionInput): Promise<ResolvedSelection> {
    if (!input || !input.claimSetId || !input.subjectRef || !input.variantRef || !input.fulfillmentRef) {
      throw new Error("INVALID_SELECTION_INPUT");
    }
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new Error("INVALID_SELECTION_QUANTITY");

    const product = this.catalogue.products.find((item) => item.subjectRef === input.subjectRef);
    const variant = product?.variants.find((item) => item.variantRef === input.variantRef);
    const fulfillment = this.catalogue.fulfillments.find((item) => item.fulfillmentRef === input.fulfillmentRef);
    if (!product) throw new Error("UNKNOWN_MERCHANT_SELECTION");
    if (!variant || !fulfillment) throw new Error("UNKNOWN_MERCHANT_SELECTION");
    if (!/^[A-Z]{3}$/.test(variant.currency)) throw new Error("INVALID_MERCHANT_CURRENCY");

    const itemTotalMinor = toMinorUnits(variant.unitAmount) * BigInt(input.quantity);
    const taxTotalMinor = toMinorUnits(variant.tax) * BigInt(input.quantity);
    const shippingMinor = toMinorUnits(fulfillment.shipping.amount);
    const itemTotal = fromMinorUnits(itemTotalMinor);
    const taxTotal = fromMinorUnits(taxTotalMinor);
    const shipping = fromMinorUnits(shippingMinor);
    const total = fromMinorUnits(itemTotalMinor + taxTotalMinor + shippingMinor);
    const cartBinding: CartBindingV1 = {
      schemaVersion: "cart-binding-v1",
      intent: "CAPTURE",
      purchaseUnitCount: 1,
      payee: this.catalogue.merchant.payee,
      currency: variant.currency,
      amountBreakdown: {
        itemTotal,
        taxTotal,
        shipping,
        handling: "0.00",
        insurance: "0.00",
        shippingDiscount: "0.00",
        discount: "0.00",
        total
      },
      shipping: { preference: "SET_PROVIDED_ADDRESS", ...fulfillment.shipping },
      items: [{
        name: product.name,
        sku: variant.sku,
        quantity: String(input.quantity),
        unitAmount: variant.unitAmount,
        tax: variant.tax
      }]
    };

    return {
      subjectRef: product.subjectRef,
      subjectHash: await hashJson({ subjectRef: product.subjectRef, variantRef: variant.variantRef }),
      cartBinding,
      cartSnapshotHash: await hashCartBinding(cartBinding)
    };
  }

  async fetchEvidence(args: {
    subjectRef: string;
    manifest: EvidenceManifestV1;
    sessionId: string;
  }): Promise<MerchantEvidenceV1[]> {
    if (!args.subjectRef || !args.sessionId) throw new Error("INVALID_EVIDENCE_REQUEST");
    const product = this.catalogue.products.find((item) => item.subjectRef === args.subjectRef);
    if (!product) throw new Error("UNKNOWN_MERCHANT_SUBJECT");
    const retrievedAt = this.now().toISOString();
    const origin = `fixture://merchant/products/${encodeURIComponent(product.subjectRef)}`;

    return Promise.all(product.evidenceFields
      .filter((field) => args.manifest.admissibleSourceClasses.includes(field.sourceClass))
      .map(async (field) => {
        const hash = await sha256(field.content);
        return {
          schemaVersion: "merchant-evidence-v1",
          evidenceId: `${product.subjectRef}:${field.fieldId}`,
          subjectRef: product.subjectRef,
          sourceClass: field.sourceClass,
          origin,
          fieldLocator: field.fieldId,
          retrievedAt,
          sessionId: args.sessionId,
          rawContent: field.content,
          rawHash: hash,
          modelView: field.content,
          modelViewHash: hash
        };
      }));
  }
}

async function hashJson(value: unknown): Promise<`sha256:${string}`> {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new Error("VALUE_NOT_JSON");
  return sha256(canonical);
}

async function sha256(value: string): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function toMinorUnits(value: string): bigint {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (!match) throw new Error("INVALID_MERCHANT_AMOUNT");
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function fromMinorUnits(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
