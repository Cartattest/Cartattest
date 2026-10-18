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
