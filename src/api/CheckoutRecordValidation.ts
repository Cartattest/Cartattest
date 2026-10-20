import type { AdmissionRecordV1, CaptureAttemptV1, CaptureAttemptState } from "../domain/types.js";

const admissionKeys = [
  "schemaVersion", "admissionId", "claimSetHash", "subjectHash", "resolvedCartSnapshotHash",
  "evidenceManifestVersion", "evidenceSetHashes", "attestationHashes", "overrideHashes",
  "policyVersion", "cartBindingProfile", "admittedCartBindingHash", "paypalOrderId",
  "outcome", "createdAt", "expiresAt"
];
const captureKeys = [
  "schemaVersion", "attemptId", "admissionId", "paypalOrderId", "materialHash", "paypalRequestId",
  "state", "paypalCaptureId", "paypalCaptureStatus", "createdAt", "updatedAt"
];
const captureStates: CaptureAttemptState[] = [
  "IN_FLIGHT", "EXECUTION_UNKNOWN", "CAPTURE_PENDING", "CAPTURE_COMPLETED_PENDING_WEBHOOK",
  "CAPTURE_DECLINED", "CAPTURE_FAILED", "CLOSED_VERIFIED_WEBHOOK", "CLOSED_RECONCILED"
];
const captureStatuses: NonNullable<CaptureAttemptV1["paypalCaptureStatus"]>[] = ["COMPLETED", "DECLINED", "PENDING", "FAILED"];

export function parseAdmissionRecordV1(value: unknown): AdmissionRecordV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, admissionKeys) || value.schemaVersion !== "admission-record-v1" ||
      !nonempty(value.admissionId) || !nonempty(value.claimSetHash) || !nonempty(value.subjectHash) ||
      !nonempty(value.resolvedCartSnapshotHash) || !nonempty(value.evidenceManifestVersion) ||
      !stringArray(value.evidenceSetHashes) || !stringArray(value.attestationHashes) || !stringArray(value.overrideHashes) ||
      !nonempty(value.policyVersion) || value.cartBindingProfile !== "v1" || !nonempty(value.admittedCartBindingHash) ||
      !nonempty(value.paypalOrderId) || value.outcome !== "ALLOW" || !validTime(value.createdAt) ||
      !validTime(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) {
    throw new Error("INVALID_ADMISSION_RECORD");
  }
  return value as unknown as AdmissionRecordV1;
}

export function parseCaptureAttemptV1(value: unknown): CaptureAttemptV1 {
  const record = isRecord(value) ? { ...value } : value;
  if (isRecord(record)) {
    if (record.paypalCaptureId === null) delete record.paypalCaptureId;
    if (record.paypalCaptureStatus === null) delete record.paypalCaptureStatus;
  }
  if (!isRecord(record) || !hasOnlyKeys(record, captureKeys) || record.schemaVersion !== "capture-attempt-v1" ||
      !nonempty(record.attemptId) || !nonempty(record.admissionId) || !nonempty(record.paypalOrderId) ||
      !nonempty(record.materialHash) || !nonempty(record.paypalRequestId) || !captureStates.includes(record.state as CaptureAttemptState) ||
      !validTime(record.createdAt) || !validTime(record.updatedAt) || Date.parse(record.updatedAt) < Date.parse(record.createdAt) ||
      (record.paypalCaptureId !== undefined && !nonempty(record.paypalCaptureId)) ||
      (record.paypalCaptureStatus !== undefined && !captureStatuses.includes(record.paypalCaptureStatus as NonNullable<CaptureAttemptV1["paypalCaptureStatus"]>)) ||
      !captureStateMatchesStatus(record.state as CaptureAttemptState, record.paypalCaptureStatus)) {
    throw new Error("INVALID_CAPTURE_ATTEMPT");
  }
  return record as unknown as CaptureAttemptV1;
}

function captureStateMatchesStatus(state: CaptureAttemptState, status: unknown): boolean {
  const requiredStatus: Partial<Record<CaptureAttemptState, NonNullable<CaptureAttemptV1["paypalCaptureStatus"]>>> = {
    CAPTURE_PENDING: "PENDING",
    CAPTURE_COMPLETED_PENDING_WEBHOOK: "COMPLETED",
    CAPTURE_DECLINED: "DECLINED",
    CAPTURE_FAILED: "FAILED",
    CLOSED_VERIFIED_WEBHOOK: "COMPLETED",
    CLOSED_RECONCILED: "COMPLETED"
  };
  if (state === "IN_FLIGHT") return status === undefined;
  return requiredStatus[state] === undefined || requiredStatus[state] === status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonempty);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
