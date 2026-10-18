export type IsoDateTime = string;
export type Sha256 = `sha256:${string}`;

export type OverridePolicy = "NEVER" | "HUMAN_EXACT_SUBJECT";
export type ClaimKind =
  | "BUDGET_MAX"
  | "MERCHANT_EXACT"
  | "SKU_EXACT"
  | "VARIANT_EXACT"
  | "QUANTITY_EXACT"
  | "CURRENCY_EXACT"
  | "TEMPORAL_MAX"
  | "SEMANTIC_BOOLEAN"
  | "SEMANTIC_TEXT";

export interface CommerceClaim {
  claimId: string;
  kind: ClaimKind;
  humanText: string;
  operator: "EQ" | "LTE" | "GTE" | "BEFORE_OR_AT" | "SUPPORTED";
  value: string | number | boolean;
  currency?: string;
  evidenceProfileId?: string;
  overridePolicy: OverridePolicy;
}

export interface ClaimSetV1 {
  schemaVersion: "claim-set-v1";
  claimSetId: string;
  buyerRequestText: string;
  claims: CommerceClaim[];
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
  buyerSignature?: Es256Signature;
}

export interface Es256Signature {
  alg: "ES256";
  keyId: string;
  signatureB64: string;
}

export type SourceClass =
  | "MERCHANT_STRUCTURED_ATTRIBUTE"
  | "MERCHANT_TECHNICAL_SPEC"
  | "MERCHANT_FULFILLMENT_PROMISE"
  | "MERCHANT_TERMS"
  | "MERCHANT_DESCRIPTION"
  | "MERCHANT_QA"
  | "CUSTOMER_REVIEW"
  | "AGENT_GENERATED_SUMMARY"
  | "UNKNOWN";

export interface MerchantEvidenceV1 {
  schemaVersion: "merchant-evidence-v1";
  evidenceId: string;
  subjectRef: string;
  sourceClass: SourceClass;
  origin: string;
  fieldLocator: string;
  retrievedAt: IsoDateTime;
  sessionId?: string;
  rawContent: string;
  rawHash: Sha256;
  modelView: string;
  modelViewHash: Sha256;
}

export interface EvidenceAuthorityRule {
  sourceClass: SourceClass;
  rank: number;
  maySatisfy: boolean;
  mayBlockIfContradictory: boolean;
}

export interface EvidenceManifestV1 {
  schemaVersion: "evidence-manifest-v1";
  evidenceProfileId: string;
  requiredSourceClasses: SourceClass[];
  admissibleSourceClasses: SourceClass[];
  sourceAuthority: EvidenceAuthorityRule[];
  freshnessSeconds: number;
  contradictionPolicy:
    | "BLOCK_EQUAL_OR_HIGHER_AUTHORITY"
    | "STEP_UP_ON_EQUAL_OR_HIGHER_AUTHORITY";
}

export interface EvidenceQuote {
  evidenceId: string;
  verbatim: string;
}

export interface SemanticAttestationV1 {
  schemaVersion: "semantic-attestation-v1";
  attestationId: string;
  claimId: string;
  subjectHash: Sha256;
  evidenceSetHash: Sha256;
  evidenceHashes: Sha256[];
  result: "SUPPORTED" | "CONTRADICTED" | "UNPROVEN";
  supportQuotes: EvidenceQuote[];
  contradictionQuotes: EvidenceQuote[];
  modelId: string;
  attestorVersion: string;
  promptHash: Sha256;
  configHash: Sha256;
  createdAt: IsoDateTime;
}

export interface BuyerOverrideV1 {
  schemaVersion: "buyer-override-v1";
  overrideId: string;
  claimSetHash: Sha256;
  claimId: string;
  subjectRef: string;
  subjectHash: Sha256;
  evidenceSetHash: Sha256;
  attestationHash: Sha256;
  decision: "ACCEPT_EXCEPTION";
  expiresAt: IsoDateTime;
  nonce: string;
  buyerSignature: Es256Signature;
}

export interface MoneyBreakdown {
  itemTotal: string;
  taxTotal: string;
  shipping: string;
  handling: string;
  insurance: string;
  shippingDiscount: string;
  discount: string;
  total: string;
}

export interface NormalizedAddress {
  addressLine1: string;
  addressLine2?: string;
  adminArea2: string;
  adminArea1?: string;
  postalCode: string;
  countryCode: string;
}

export interface CartBindingItemV1 {
  name: string;
  sku: string; // SKU uniquely identifies the purchasable variant in the demo catalogue.
  quantity: string;
  unitAmount: string;
  tax: string;
}

export interface CartBindingV1 {
  schemaVersion: "cart-binding-v1";
  intent: "CAPTURE";
  purchaseUnitCount: 1;
  payee: { identityType: "MERCHANT_ID" | "EMAIL"; identityValue: string };
  currency: string;
  amountBreakdown: MoneyBreakdown;
  shipping: {
    preference: "SET_PROVIDED_ADDRESS";
    name: string;
    address: NormalizedAddress;
    optionId: string;
    type: string;
    amount: string;
  };
  items: CartBindingItemV1[];
}

export interface AdmissionRecordV1 {
  schemaVersion: "admission-record-v1";
  admissionId: string;
  claimSetHash: Sha256;
  subjectHash: Sha256;
  resolvedCartSnapshotHash: Sha256;
  evidenceManifestVersion: string;
  evidenceSetHashes: Sha256[];
  attestationHashes: Sha256[];
  overrideHashes: Sha256[];
  policyVersion: string;
  cartBindingProfile: "v1";
  admittedCartBindingHash: Sha256;
  paypalOrderId: string;
  outcome: "ALLOW";
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export type CaptureAttemptState =
  | "IN_FLIGHT"
  | "EXECUTION_UNKNOWN"
  | "CAPTURE_PENDING"
  | "CAPTURE_COMPLETED_PENDING_WEBHOOK"
  | "CAPTURE_DECLINED"
  | "CAPTURE_FAILED"
  | "CLOSED_VERIFIED_WEBHOOK"
  | "CLOSED_RECONCILED";

export interface CaptureAttemptV1 {
  schemaVersion: "capture-attempt-v1";
  attemptId: string;
  admissionId: string;
  paypalOrderId: string;
  materialHash: Sha256;
  paypalRequestId: string;
  state: CaptureAttemptState;
  paypalCaptureId?: string;
  paypalCaptureStatus?: "COMPLETED" | "DECLINED" | "PENDING" | "FAILED";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface BundleSealV1 {
  schemaVersion: "bundle-seal-v1";
  bundleId: string;
  recordCount: number;
  terminalEventHash: Sha256;
  orderId?: string;
  captureId?: string;
  closureState: "CLOSED_VERIFIED_WEBHOOK" | "CLOSED_RECONCILED";
  sealedAt: IsoDateTime;
  keyId: string;
  signatureB64: string;
}
