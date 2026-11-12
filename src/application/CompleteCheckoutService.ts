import { parseCompleteCheckoutRequest } from "../api/contracts.js";
import { assertBindingEqual, hashCartBinding, mapPayPalOrderToBinding } from "../binding/CartBindingV1.js";
import type { AdmissionRecordV1, CaptureAttemptV1, CartBindingV1 } from "../domain/types.js";
import { checkApprovedOrderBinding } from "../execution/BindingChecks.js";
import type { PayPalGateway } from "../ports/PayPalGateway.js";
import { abortAwaitingAdmission, loadAwaitingAdmission } from "../persistence/AdmissionRepository.js";
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
  if (admission.admissionState === "AWAITING_APPROVAL") {
    try {
      await checkApprovedOrderBinding(
        dependencies.gateway,
        admission.record.paypalOrderId,
        admission.admittedCartBinding,
        admission.record.expiresAt,
        now.getTime()
      );
    } catch (error) {
      if (error instanceof Error && ["CART_BINDING_MISMATCH", "PAYPAL_ORDER_ID_MISMATCH"].includes(error.message)) {
        try { await abortAwaitingAdmission(dependencies.pool, admissionId); } catch { /* Preserve the Binding B failure. */ }
      }
      throw error;
    }
  }

  const createdAt = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(createdAt.getTime())) throw new Error("INVALID_POLICY_TIME");
  const newAttemptId = dependencies.newId();
  const attempt = await startCaptureAttempt(dependencies.pool, {
    schemaVersion: "capture-attempt-v1",
    attemptId: newAttemptId,
    admissionId,
    paypalOrderId: admission.record.paypalOrderId,
    materialHash: await hashCartBinding(admission.admittedCartBinding),
    paypalRequestId: dependencies.newId(),
    state: "IN_FLIGHT",
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString()
  }, createdAt.toISOString());

  if (attempt.attemptId !== newAttemptId || attempt.state === "EXECUTION_UNKNOWN" || attempt.state === "CAPTURE_PENDING" ||
      attempt.state === "CAPTURE_COMPLETED_PENDING_WEBHOOK") {
    return reconcileCapture(dependencies, attempt, admission);
  }
  if (attempt.state !== "IN_FLIGHT") return attempt;

  return capture(dependencies, attempt);
}

async function capture(dependencies: CompleteCheckoutDependencies, attempt: CaptureAttemptV1): Promise<CaptureAttemptV1> {
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

async function reconcileCapture(
  dependencies: CompleteCheckoutDependencies,
  attempt: CaptureAttemptV1,
  admission: { record: AdmissionRecordV1; admittedCartBinding: CartBindingV1 }
): Promise<CaptureAttemptV1> {
  const current = await dependencies.gateway.getOrder(attempt.paypalOrderId);
  if (current.orderId !== attempt.paypalOrderId) throw new Error("PAYPAL_ORDER_ID_MISMATCH");
  const captures = captureSnapshots(current.raw);
  const reported = captures.find((capture) => capture.status === "COMPLETED" || capture.status === "PENDING" ||
    capture.status === "DECLINED" || capture.status === "FAILED");
  if (reported) {
    const now = dependencies.now?.() ?? new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("INVALID_POLICY_TIME");
    if (reported.status === "COMPLETED") {
      return transitionCaptureAttempt(dependencies.pool, attempt.attemptId, "RECONCILED_COMPLETED", now.toISOString(), reported.id);
    }
    if (attempt.state === "CAPTURE_COMPLETED_PENDING_WEBHOOK") return attempt;
    if (reported.status !== "PENDING" && reported.status !== "DECLINED" && reported.status !== "FAILED") return attempt;
    const event = { PENDING: "PAYPAL_PENDING", DECLINED: "PAYPAL_DECLINED", FAILED: "PAYPAL_FAILED" } as const;
    if ((attempt.state === "CAPTURE_PENDING" && reported.status === "PENDING") ||
        (attempt.state === "CAPTURE_PENDING" && reported.status === attempt.paypalCaptureStatus)) return attempt;
    return transitionCaptureAttempt(dependencies.pool, attempt.attemptId, event[reported.status], now.toISOString(), reported.id);
  }
  if ((attempt.state === "IN_FLIGHT" || attempt.state === "EXECUTION_UNKNOWN") && current.orderStatus === "APPROVED") {
    // A retry issues a new capture request, so it must re-establish everything the fresh path checked:
    // the admission is still valid and the current PayPal order still matches the admitted cart (Binding B).
    // Without this, an order changed after an ambiguous first attempt would be captured. Uses the same GET.
    const checkedAt = dependencies.now?.() ?? new Date();
    const expiresAt = Date.parse(admission.record.expiresAt);
    if (!Number.isFinite(checkedAt.getTime()) || !Number.isFinite(expiresAt) || checkedAt.getTime() >= expiresAt) {
      throw new Error("ADMISSION_EXPIRED");
    }
    assertBindingEqual(
      admission.admittedCartBinding,
      mapPayPalOrderToBinding(current.raw, admission.admittedCartBinding.shipping.preference)
    );
    return capture(dependencies, attempt);
  }
  return attempt;
}

function captureSnapshots(raw: unknown): Array<{ id?: string; status?: string }> {
  if (!isRecord(raw) || !Array.isArray(raw.purchase_units)) return [];
  return raw.purchase_units.flatMap((unit) => isRecord(unit) && isRecord(unit.payments) && Array.isArray(unit.payments.captures)
    ? unit.payments.captures.filter(isRecord).map((capture) => ({
      ...(typeof capture.id === "string" ? { id: capture.id } : {}),
      ...(typeof capture.status === "string" ? { status: capture.status } : {})
    }))
    : []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function markAmbiguous(pool: SqlPool, attemptId: string, now: Date): Promise<void> {
  try {
    if (Number.isFinite(now.getTime())) await transitionCaptureAttempt(pool, attemptId, "AMBIGUOUS_RESPONSE", now.toISOString());
  } catch { /* Preserve the original PayPal response failure; reconciliation can inspect the persisted attempt. */ }
}
