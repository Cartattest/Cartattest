import canonicalize from "canonicalize";
import { verifyBundleShape, type EvidenceBundleV1 } from "../bundle/EvidenceBundle.js";
import type { SqlPool } from "./CaptureAttemptRepository.js";

export async function saveEvidenceBundle(pool: SqlPool, bundle: EvidenceBundleV1): Promise<void> {
  verifyBundleShape(bundle);
  const client = await pool.connect();
  try {
    const inserted = await client.query(
      `INSERT INTO evidence_bundles (bundle_id, bundle) VALUES ($1, $2)
       ON CONFLICT (bundle_id) DO NOTHING RETURNING bundle_id`,
      [bundle.bundleId, bundle]
    );
    if (inserted.rows[0]) return;

    const existing = await client.query("SELECT bundle FROM evidence_bundles WHERE bundle_id = $1", [bundle.bundleId]);
    if (canonicalize(existing.rows[0]?.bundle) !== canonicalize(bundle)) throw new Error("EVIDENCE_BUNDLE_ID_CONFLICT");
  } finally {
    client.release();
  }
}

export async function loadEvidenceBundle(pool: SqlPool, bundleId: string): Promise<EvidenceBundleV1> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(bundleId)) throw new Error("INVALID_BUNDLE_ID");
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT bundle FROM evidence_bundles WHERE bundle_id = $1", [bundleId]);
    if (!result.rows[0]) throw new Error("EVIDENCE_BUNDLE_NOT_FOUND");
    const bundle = result.rows[0].bundle as EvidenceBundleV1;
    verifyBundleShape(bundle);
    if (bundle.bundleId !== bundleId) throw new Error("INVALID_EVIDENCE_BUNDLE");
    return bundle;
  } finally {
    client.release();
  }
}
