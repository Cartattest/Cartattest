import { parseAdmissionRecordV1 } from "../api/CheckoutRecordValidation.js";
import { hashCartBinding } from "../binding/CartBindingV1.js";
import type { AdmissionRecordV1, CartBindingV1 } from "../domain/types.js";
import type { SqlPool } from "./CaptureAttemptRepository.js";

export type AdmissionCreation = Omit<AdmissionRecordV1, "paypalOrderId"> & {
  claimSetId: string;
  subjectRef: string;
  admittedCartBinding: CartBindingV1;
};

export async function createAdmission(pool: SqlPool, input: AdmissionCreation): Promise<void> {
  const { claimSetId, subjectRef, admittedCartBinding, ...record } = input;
  parseAdmissionRecordV1({ ...record, paypalOrderId: "pending-order" });
  if (typeof claimSetId !== "string" || !claimSetId.trim() || typeof subjectRef !== "string" || !subjectRef.trim() ||
      !isRecord(admittedCartBinding) || await hashCartBinding(admittedCartBinding as unknown as CartBindingV1) !== record.admittedCartBindingHash) {
    throw new Error("INVALID_ADMISSION_RECORD");
  }

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO admissions
         (admission_id, claim_set_id, subject_ref, subject_hash, resolved_cart_snapshot_hash,
          evidence_manifest_version, evidence_set_hashes, attestation_hashes, override_hashes,
          policy_version, cart_binding_profile, admitted_cart_binding, admitted_cart_binding_hash,
          paypal_order_id, state, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, 'CREATING_ORDER', $14, $15)`,
      [record.admissionId, claimSetId, subjectRef, record.subjectHash, record.resolvedCartSnapshotHash,
        record.evidenceManifestVersion, record.evidenceSetHashes, record.attestationHashes, record.overrideHashes,
        record.policyVersion, record.cartBindingProfile, admittedCartBinding, record.admittedCartBindingHash,
        record.createdAt, record.expiresAt]
    );
  } finally {
    client.release();
  }
}

export async function attachPaypalOrderAfterBindingA(
  pool: SqlPool,
  admissionId: string,
  paypalOrderId: string,
  now: string
): Promise<void> {
  if (![admissionId, paypalOrderId].every((value) => typeof value === "string" && value.trim()) || !Number.isFinite(Date.parse(now))) {
    throw new Error("INVALID_ADMISSION_RECORD");
  }
  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE admissions SET paypal_order_id = $2, state = 'AWAITING_APPROVAL'
       WHERE admission_id = $1 AND state = 'CREATING_ORDER' AND expires_at > $3
       RETURNING admission_id AS "admissionId"`,
      [admissionId, paypalOrderId, now]
    );
    if (!result.rows[0]) throw new Error("ADMISSION_NOT_CAPTUREABLE");
  } finally {
    client.release();
  }
}

export async function abortAdmission(pool: SqlPool, admissionId: string): Promise<void> {
  if (typeof admissionId !== "string" || !admissionId.trim()) throw new Error("INVALID_ADMISSION_ID");
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE admissions SET state = 'ABORTED' WHERE admission_id = $1 AND state = 'CREATING_ORDER'`,
      [admissionId]
    );
  } finally {
    client.release();
  }
}

export async function abortAwaitingAdmission(pool: SqlPool, admissionId: string): Promise<void> {
  if (typeof admissionId !== "string" || !admissionId.trim()) throw new Error("INVALID_ADMISSION_ID");
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE admissions SET state = 'ABORTED' WHERE admission_id = $1 AND state = 'AWAITING_APPROVAL'`,
      [admissionId]
    );
  } finally {
    client.release();
  }
}

export async function loadCheckoutStatus(
  pool: SqlPool,
  admissionId: string
): Promise<{ admissionState: "AWAITING_APPROVAL" | "CAPTURE_STARTED" | "CLOSED" | "ABORTED"; expiresAt: string; capture?: {
  state: string; status?: string
} }> {
  if (typeof admissionId !== "string" || !admissionId.trim()) throw new Error("INVALID_ADMISSION_ID");
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT a.state AS "admissionState", a.expires_at::text AS "expiresAt",
              ca.state AS "captureState", ca.paypal_capture_status AS "captureStatus"
       FROM admissions a LEFT JOIN capture_attempts ca ON ca.admission_id = a.admission_id
       WHERE a.admission_id = $1 ORDER BY ca.created_at DESC LIMIT 1`,
      [admissionId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("ADMISSION_NOT_FOUND");
    if (!(["AWAITING_APPROVAL", "CAPTURE_STARTED", "CLOSED", "ABORTED"] as unknown[]).includes(row.admissionState) ||
        typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) ||
        (row.captureState !== null && typeof row.captureState !== "string") ||
        (row.captureStatus !== null && typeof row.captureStatus !== "string")) throw new Error("ADMISSION_INTEGRITY_FAILURE");
    return {
      admissionState: row.admissionState as "AWAITING_APPROVAL" | "CAPTURE_STARTED" | "CLOSED" | "ABORTED",
      expiresAt: row.expiresAt,
      ...(typeof row.captureState === "string" ? { capture: {
        state: row.captureState,
        ...(typeof row.captureStatus === "string" ? { status: row.captureStatus } : {})
      } } : {})
    };
  } finally {
    client.release();
  }
}

export async function loadAwaitingAdmission(
  pool: SqlPool,
  admissionId: string,
  now: string
): Promise<{ record: AdmissionRecordV1; subjectRef: string; admittedCartBinding: CartBindingV1 }> {
  if (typeof admissionId !== "string" || !admissionId.trim() || !Number.isFinite(Date.parse(now))) {
    throw new Error("INVALID_ADMISSION_ID");
  }
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT 'admission-record-v1' AS "schemaVersion", admission_id AS "admissionId",
              cs.claim_set_hash AS "claimSetHash", a.subject_hash AS "subjectHash",
              a.resolved_cart_snapshot_hash AS "resolvedCartSnapshotHash",
              a.evidence_manifest_version AS "evidenceManifestVersion", a.evidence_set_hashes AS "evidenceSetHashes",
              a.attestation_hashes AS "attestationHashes", a.override_hashes AS "overrideHashes",
              a.policy_version AS "policyVersion", a.cart_binding_profile AS "cartBindingProfile",
              a.admitted_cart_binding_hash AS "admittedCartBindingHash", a.paypal_order_id AS "paypalOrderId",
              'ALLOW' AS outcome, a.created_at::text AS "createdAt", a.expires_at::text AS "expiresAt",
              a.subject_ref AS "subjectRef", a.admitted_cart_binding AS "admittedCartBinding"
       FROM admissions a JOIN claim_sets cs ON cs.claim_set_id = a.claim_set_id
       WHERE a.admission_id = $1 AND a.state = 'AWAITING_APPROVAL' AND a.expires_at > $2`,
      [admissionId, now]
    );
    const row = result.rows[0];
    if (!row) throw new Error("ADMISSION_NOT_CAPTUREABLE");
    const { subjectRef, admittedCartBinding, ...recordFields } = row;
    if (typeof subjectRef !== "string" || !subjectRef.trim() || !isRecord(admittedCartBinding)) throw new Error("INVALID_ADMISSION_RECORD");
    const record = parseAdmissionRecordV1(recordFields);
    if (await hashCartBinding(admittedCartBinding as unknown as CartBindingV1) !== record.admittedCartBindingHash) {
      throw new Error("ADMISSION_INTEGRITY_FAILURE");
    }
    return {
      record,
      subjectRef,
      admittedCartBinding: admittedCartBinding as unknown as CartBindingV1
    };
  } finally {
    client.release();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
