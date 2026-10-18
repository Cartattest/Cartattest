import type { SelectionInput } from "../ports/MerchantAdapter.js";

export type SubmitSelectionRequest = SelectionInput;

export type SubmitSelectionResponse =
  | { status: "BLOCKED"; reason: string }
  | { status: "STEP_UP"; admissionId: string; decisionUrl: string }
  | { status: "ALLOWED"; admissionId: string; approvalUrl: string };

export interface CompleteCheckoutRequest {
  admissionId: string;
  // Deliberately no caller-supplied PayPal order ID. Resolve it from AdmissionRecord.
}

const selectionKeys = ["claimSetId", "subjectRef", "variantRef", "quantity", "fulfillmentRef"] as const;

export function parseSubmitSelectionRequest(value: unknown): SubmitSelectionRequest {
  if (!isRecord(value) || !hasExactKeys(value, selectionKeys) ||
      !isNonemptyString(value.claimSetId) || !isNonemptyString(value.subjectRef) ||
      !isNonemptyString(value.variantRef) || !isNonemptyString(value.fulfillmentRef) ||
      typeof value.quantity !== "number" || !Number.isSafeInteger(value.quantity) || value.quantity < 1) {
    throw new Error("INVALID_SUBMIT_SELECTION_REQUEST");
  }
  return {
    claimSetId: value.claimSetId,
    subjectRef: value.subjectRef,
    variantRef: value.variantRef,
    quantity: value.quantity,
    fulfillmentRef: value.fulfillmentRef
  };
}

export function parseCompleteCheckoutRequest(value: unknown): CompleteCheckoutRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["admissionId"]) || !isNonemptyString(value.admissionId)) {
    throw new Error("INVALID_COMPLETE_CHECKOUT_REQUEST");
  }
  return { admissionId: value.admissionId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
