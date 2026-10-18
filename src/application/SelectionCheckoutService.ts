import type { AdmissionRecordV1 } from "../domain/types.js";
import { hashCartBinding } from "../binding/CartBindingV1.js";
import type { PayPalGateway } from "../ports/PayPalGateway.js";
import { createOrderWithBindingA } from "../execution/BindingChecks.js";
import type { SelectionAdmissionResult } from "./SelectionAdmissionEvaluator.js";
import { abortAdmission, attachPaypalOrderAfterBindingA, createAdmission, type AdmissionCreation } from "../persistence/AdmissionRepository.js";
import type { SqlPool } from "../persistence/CaptureAttemptRepository.js";

export interface SelectionCheckoutDependencies {
  pool: SqlPool;
  gateway: PayPalGateway;
  newId(): string;
  now?(): Date;
  policyVersion: string;
}

export async function createOrderAfterAdmission(
  evaluation: SelectionAdmissionResult,
  dependencies: SelectionCheckoutDependencies
): Promise<{ outcome: SelectionAdmissionResult["outcome"] } | { outcome: { status: "ALLOW" }; admissionId: string; approvalUrl: string }> {
  if (evaluation.outcome.status !== "ALLOW") return { outcome: evaluation.outcome };
  if (!("claimSet" in evaluation)) throw new Error("INVALID_ADMISSION_EVALUATION");

  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_POLICY_TIME");
  const admissionId = dependencies.newId();
  const record: Omit<AdmissionRecordV1, "paypalOrderId"> = {
    schemaVersion: "admission-record-v1",
    admissionId,
    claimSetHash: evaluation.claimSetHash,
    subjectHash: evaluation.resolvedSelection.subjectHash,
    resolvedCartSnapshotHash: evaluation.resolvedSelection.cartSnapshotHash,
    ...evaluation.admissionEvidence,
    policyVersion: dependencies.policyVersion,
    cartBindingProfile: "v1",
    admittedCartBindingHash: await hashCartBinding(evaluation.resolvedSelection.cartBinding),
    outcome: "ALLOW",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString()
  };
  const input: AdmissionCreation = {
    ...record,
    claimSetId: evaluation.claimSet.claimSetId,
    subjectRef: evaluation.resolvedSelection.subjectRef,
    admittedCartBinding: evaluation.resolvedSelection.cartBinding
  };
  await createAdmission(dependencies.pool, input);

  try {
    const order = await createOrderWithBindingA(dependencies.gateway, evaluation.resolvedSelection.cartBinding);
    const attachedAt = dependencies.now?.() ?? new Date();
    if (!Number.isFinite(attachedAt.getTime())) throw new Error("INVALID_POLICY_TIME");
    await attachPaypalOrderAfterBindingA(dependencies.pool, admissionId, order.orderId, attachedAt.toISOString());
    return { outcome: { status: "ALLOW" }, admissionId, approvalUrl: order.approvalUrl };
  } catch (error) {
    try { await abortAdmission(dependencies.pool, admissionId); } catch { /* preserve the order or persistence failure */ }
    throw error;
  }
}
