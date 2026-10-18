import { parseCompleteCheckoutRequest } from "../api/contracts.js";
import { hashCartBinding } from "../binding/CartBindingV1.js";
import type { CaptureAttemptV1 } from "../domain/types.js";
import { checkApprovedOrderBinding } from "../execution/BindingChecks.js";
import type { PayPalGateway } from "../ports/PayPalGateway.js";
import { loadAwaitingAdmission } from "../persistence/AdmissionRepository.js";
import { startCaptureAttempt, transitionCaptureAttempt } from "../persistence/CaptureAttemptRepository.js";
import type { SqlPool } from "../persistence/CaptureAttemptRepository.js";

export interface CompleteCheckoutDependencies {
  pool: SqlPool;
  gateway: PayPalGateway;
  newId(): string;
  now?(): Date;
}

export async function completeCheckout(input: unknown, dependencies: CompleteCheckoutDependencies): Promise<CaptureAttemptV1> {
  const { admissionId } = parseCompleteCheckoutRequest(input);
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_POLICY_TIME");
  const admission = await loadAwaitingAdmission(dependencies.pool, admissionId, now.toISOString());
  await checkApprovedOrderBinding(
    dependencies.gateway,
    admission.record.paypalOrderId,
    admission.admittedCartBinding,
    admission.record.expiresAt,
    now.getTime()
  );

  const createdAt = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(createdAt.getTime())) throw new Error("INVALID_POLICY_TIME");
  const attempt = await startCaptureAttempt(dependencies.pool, {
    schemaVersion: "capture-attempt-v1",
    attemptId: dependencies.newId(),
    admissionId,
    paypalOrderId: admission.record.paypalOrderId,
    materialHash: await hashCartBinding(admission.admittedCartBinding),
    paypalRequestId: dependencies.newId(),
    state: "IN_FLIGHT",
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString()
  }, createdAt.toISOString());

  if (attempt.state !== "IN_FLIGHT") return attempt;

  let response;
  try {
    response = await dependencies.gateway.captureOrder(attempt.paypalOrderId, attempt.paypalRequestId);
    if (response.orderId !== attempt.paypalOrderId || !response.captureStatus) throw new Error("PAYPAL_CAPTURE_RESPONSE_INVALID");
  } catch (error) {
    await markAmbiguous(dependencies.pool, attempt.attemptId, dependencies.now?.() ?? new Date());
    throw error;
  }

  const updatedAt = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(updatedAt.getTime())) throw new Error("INVALID_POLICY_TIME");
  const event = {
    COMPLETED: "PAYPAL_COMPLETED",
    PENDING: "PAYPAL_PENDING",
    DECLINED: "PAYPAL_DECLINED",
    FAILED: "PAYPAL_FAILED"
  } as const;
  return transitionCaptureAttempt(dependencies.pool, attempt.attemptId, event[response.captureStatus], updatedAt.toISOString(), response.captureId);
}

async function markAmbiguous(pool: SqlPool, attemptId: string, now: Date): Promise<void> {
  try {
    if (Number.isFinite(now.getTime())) await transitionCaptureAttempt(pool, attemptId, "AMBIGUOUS_RESPONSE", now.toISOString());
  } catch { /* Preserve the original PayPal response failure; reconciliation can inspect the persisted attempt. */ }
}
