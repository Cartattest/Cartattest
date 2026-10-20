import { createEvidenceBundle } from "../bundle/EvidenceBundle.js";
import type { EvidenceBundleV1 } from "../bundle/EvidenceBundle.js";
import type { SqlPool } from "../persistence/CaptureAttemptRepository.js";
import { loadEvidenceBundle, saveEvidenceBundle } from "../persistence/EvidenceBundleRepository.js";

export interface EvidenceBundleSigningConfig {
  keyId: string;
  privateKey: CryptoKey;
  trustedKeys: ReadonlyMap<string, CryptoKey>;
}

export async function finalizeEvidenceBundle(
  pool: SqlPool,
  admissionId: string,
  signing: EvidenceBundleSigningConfig
): Promise<EvidenceBundleV1> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(admissionId)) throw new Error("INVALID_ADMISSION_ID");
  try { return await loadEvidenceBundle(pool, admissionId, signing.trustedKeys); }
  catch (error) { if (!(error instanceof Error) || error.message !== "EVIDENCE_BUNDLE_NOT_FOUND") throw error; }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT a.admission_id AS "admissionId", cs.claim_set_hash AS "claimSetHash", a.subject_ref AS "subjectRef",
              a.subject_hash AS "subjectHash", a.resolved_cart_snapshot_hash AS "resolvedCartSnapshotHash",
              a.evidence_manifest_version AS "evidenceManifestVersion", a.evidence_set_hashes AS "evidenceSetHashes",
              a.attestation_hashes AS "attestationHashes", a.override_hashes AS "overrideHashes",
              a.policy_version AS "policyVersion", a.cart_binding_profile AS "cartBindingProfile",
              a.admitted_cart_binding AS "admittedCartBinding", a.admitted_cart_binding_hash AS "admittedCartBindingHash",
              a.paypal_order_id AS "paypalOrderId", a.created_at::text AS "createdAt",
              a.expires_at::text AS "expiresAt", a.evidence_snapshot AS "evidenceSnapshot",
              ca.attempt_id AS "attemptId", ca.material_hash AS "materialHash", ca.paypal_request_id AS "paypalRequestId",
              ca.state AS "captureState", ca.paypal_capture_id AS "captureId", ca.paypal_capture_status AS "captureStatus",
              ca.created_at::text AS "captureCreatedAt", ca.updated_at::text AS "sealedAt"
       FROM admissions a JOIN claim_sets cs ON cs.claim_set_id = a.claim_set_id
       JOIN capture_attempts ca ON ca.admission_id = a.admission_id
       WHERE a.admission_id = $1 AND a.state = 'CLOSED'
         AND ca.state IN ('CLOSED_VERIFIED_WEBHOOK', 'CLOSED_RECONCILED')
       ORDER BY ca.updated_at DESC LIMIT 1`, [admissionId]
    );
    const admission = result.rows[0];
    if (!admission) throw new Error("CLOSED_ADMISSION_NOT_FOUND");
    const snapshot = admission.evidenceSnapshot as Record<string, unknown>;
    if (!snapshot || snapshot.schemaVersion !== "checkout-evidence-snapshot-v1" || !isRecord(snapshot.claimSet) ||
        !isRecord(snapshot.resolvedSelection) || !Array.isArray(snapshot.claimEvaluations)) {
      throw new Error("ADMISSION_EVIDENCE_SNAPSHOT_INVALID");
    }
    const events: Array<{ recordType: string; payload: unknown }> = [
      { recordType: "BuyerClaimSet", payload: snapshot.claimSet },
      { recordType: "ResolvedSelection", payload: snapshot.resolvedSelection }
    ];
    const seen = new Set<string>();
    for (const value of snapshot.claimEvaluations) {
      if (!isRecord(value)) throw new Error("ADMISSION_EVIDENCE_SNAPSHOT_INVALID");
      if (isRecord(value.evidenceManifest)) addUnique(events, seen, "EvidenceManifest", value.evidenceManifest);
      if (Array.isArray(value.evidence)) for (const evidence of value.evidence) {
        if (!isRecord(evidence) || typeof evidence.evidenceId !== "string") throw new Error("ADMISSION_EVIDENCE_SNAPSHOT_INVALID");
        addUnique(events, seen, "MerchantEvidence", evidence, evidence.evidenceId);
      }
      if (isRecord(value.attestation)) addUnique(events, seen, "SemanticAttestation", value.attestation);
      if (isRecord(value.override)) addUnique(events, seen, "BuyerOverride", value.override);
    }
    events.push(
      { recordType: "AdmissionRecord", payload: admissionRecord(admission) },
      { recordType: "BindingA", payload: { result: "MATCH", admittedCartBindingHash: admission.admittedCartBindingHash } },
      { recordType: "PayPalApproval", payload: { orderId: admission.paypalOrderId, result: "APPROVED" } },
      { recordType: "BindingB", payload: { result: "MATCH", admittedCartBindingHash: admission.admittedCartBindingHash } },
      { recordType: "CaptureAttempt", payload: {
        schemaVersion: "capture-attempt-v1", attemptId: admission.attemptId, admissionId,
        paypalOrderId: admission.paypalOrderId, materialHash: admission.materialHash,
        paypalRequestId: admission.paypalRequestId, state: admission.captureState,
        ...(typeof admission.captureId === "string" ? { paypalCaptureId: admission.captureId } : {}),
        ...(typeof admission.captureStatus === "string" ? { paypalCaptureStatus: admission.captureStatus } : {}),
        createdAt: admission.captureCreatedAt, updatedAt: admission.sealedAt
      } }
    );
    const webhooks = await client.query(
      `SELECT event_id AS "eventId", event_type AS "eventType", paypal_order_id AS "orderId",
              paypal_capture_id AS "captureId", verified_at::text AS "verifiedAt", payload
       FROM paypal_webhook_events WHERE paypal_order_id = $1 ORDER BY verified_at, event_id`,
      [admission.paypalOrderId]
    );
    for (const event of webhooks.rows) events.push({ recordType: "PayPalWebhookVerification", payload: event });
    const bundle = await createEvidenceBundle({
      bundleId: admissionId,
      events,
      seal: {
        closureState: admission.captureState as "CLOSED_VERIFIED_WEBHOOK" | "CLOSED_RECONCILED",
        sealedAt: admission.sealedAt as string,
        orderId: admission.paypalOrderId as string,
        ...(typeof admission.captureId === "string" ? { captureId: admission.captureId } : {})
      },
      keyId: signing.keyId,
      privateKey: signing.privateKey
    });
    try {
      await saveEvidenceBundle(pool, bundle, signing.trustedKeys);
      return bundle;
    } catch (error) {
      if (error instanceof Error && error.message === "EVIDENCE_BUNDLE_ID_CONFLICT") {
        return loadEvidenceBundle(pool, admissionId, signing.trustedKeys);
      }
      throw error;
    }
  } finally { client.release(); }
}

function admissionRecord(row: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: "admission-record-v1", admissionId: row.admissionId, claimSetHash: row.claimSetHash,
    subjectHash: row.subjectHash, resolvedCartSnapshotHash: row.resolvedCartSnapshotHash,
    evidenceManifestVersion: row.evidenceManifestVersion, evidenceSetHashes: row.evidenceSetHashes,
    attestationHashes: row.attestationHashes, overrideHashes: row.overrideHashes, policyVersion: row.policyVersion,
    cartBindingProfile: row.cartBindingProfile, admittedCartBindingHash: row.admittedCartBindingHash,
    paypalOrderId: row.paypalOrderId, outcome: "ALLOW", createdAt: row.createdAt, expiresAt: row.expiresAt
  };
}

function addUnique(events: Array<{ recordType: string; payload: unknown }>, seen: Set<string>, type: string, payload: unknown, id = JSON.stringify(payload)): void {
  const key = `${type}:${id}`;
  if (!seen.has(key)) { seen.add(key); events.push({ recordType: type, payload }); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
