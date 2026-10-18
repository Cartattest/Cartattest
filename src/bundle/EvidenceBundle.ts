import canonicalize from "canonicalize";
import { sha256 } from "../domain/Hash.js";
import type { BundleSealV1, Sha256 } from "../domain/types.js";

export interface BundleRecord {
  index: number;
  recordType: string;
  payload: unknown;
  payloadHash: Sha256;
  previousEventHash: Sha256 | null;
  keyId: string;
  signatureB64: string;
}

export interface EvidenceBundleV1 {
  schemaVersion: "evidence-bundle-v1";
  bundleId: string;
  records: BundleRecord[];
  seal: BundleSealV1;
}

export async function createEvidenceBundle(args: {
  bundleId: string;
  events: Array<{ recordType: string; payload: unknown }>;
  seal: Pick<BundleSealV1, "closureState" | "sealedAt"> & Partial<Pick<BundleSealV1, "orderId" | "captureId">>;
  keyId: string;
  privateKey: CryptoKey;
}): Promise<EvidenceBundleV1> {
  if (!nonempty(args.bundleId) || !nonempty(args.keyId) || !Array.isArray(args.events) || args.events.length === 0 ||
      args.privateKey.algorithm.name !== "ECDSA" || !("namedCurve" in args.privateKey.algorithm) ||
      args.privateKey.algorithm.namedCurve !== "P-256" || !args.privateKey.usages.includes("sign")) {
    throw new Error("INVALID_BUNDLE_CREATION_INPUT");
  }

  const records: BundleRecord[] = [];
  let previousEventHash: Sha256 | null = null;
  for (const [index, event] of args.events.entries()) {
    if (!event || !nonempty(event.recordType)) throw new Error("INVALID_BUNDLE_CREATION_INPUT");
    const payload = canonicalize(event.payload);
    if (payload === undefined) throw new Error("INVALID_BUNDLE_CREATION_INPUT");
    const payloadHash = await sha256(payload);
    const signedRecord = { bundleId: args.bundleId, index, recordType: event.recordType, payloadHash, previousEventHash, keyId: args.keyId };
    const signatureB64 = await sign(signedRecord, args.privateKey);
    records.push({ index, recordType: event.recordType, payload: event.payload, payloadHash, previousEventHash, keyId: args.keyId, signatureB64 });
    const eventHashInput = canonicalize({ ...signedRecord, signatureB64 });
    if (eventHashInput === undefined) throw new Error("INVALID_BUNDLE_CREATION_INPUT");
    previousEventHash = await sha256(eventHashInput);
  }

  const unsignedSeal = {
    schemaVersion: "bundle-seal-v1" as const,
    bundleId: args.bundleId,
    recordCount: records.length,
    terminalEventHash: previousEventHash!,
    ...(args.seal.orderId === undefined ? {} : { orderId: args.seal.orderId }),
    ...(args.seal.captureId === undefined ? {} : { captureId: args.seal.captureId }),
    closureState: args.seal.closureState,
    sealedAt: args.seal.sealedAt,
    keyId: args.keyId
  };
  const signedSeal: BundleSealV1 = { ...unsignedSeal, signatureB64: await sign(unsignedSeal, args.privateKey) };
  const bundle: EvidenceBundleV1 = { schemaVersion: "evidence-bundle-v1", bundleId: args.bundleId, records, seal: signedSeal };
  verifyBundleShape(bundle);
  return bundle;
}

/**
 * Offline verification MUST obtain the trusted CartAttest service public key from outside the bundle
 * (repo/config/CLI argument or other pinned distribution channel). Never trust a key embedded only in the bundle.
 */
export function verifyBundleShape(bundle: EvidenceBundleV1): void {
  if (!bundle || bundle.schemaVersion !== "evidence-bundle-v1" || !nonempty(bundle.bundleId) ||
      !Array.isArray(bundle.records) || !bundle.seal || bundle.seal.schemaVersion !== "bundle-seal-v1" ||
      bundle.seal.bundleId !== bundle.bundleId || !hasOnlyKeys(bundle, ["schemaVersion", "bundleId", "records", "seal"]) ||
      !hasOnlyKeys(bundle.seal, ["schemaVersion", "bundleId", "recordCount", "terminalEventHash", "orderId", "captureId", "closureState", "sealedAt", "keyId", "signatureB64"])) {
    throw new Error("INVALID_EVIDENCE_BUNDLE");
  }
  if (bundle.seal.recordCount !== bundle.records.length) throw new Error("BUNDLE_TRUNCATED_OR_COUNT_MISMATCH");
  if (bundle.records.length === 0) throw new Error("EMPTY_BUNDLE");
  if (!Number.isInteger(bundle.seal.recordCount) || !validHash(bundle.seal.terminalEventHash) ||
      !nonempty(bundle.seal.keyId) || !validBase64(bundle.seal.signatureB64) ||
      !["CLOSED_VERIFIED_WEBHOOK", "CLOSED_RECONCILED"].includes(bundle.seal.closureState) ||
      !validTime(bundle.seal.sealedAt) ||
      (bundle.seal.orderId !== undefined && !nonempty(bundle.seal.orderId)) ||
      (bundle.seal.captureId !== undefined && !nonempty(bundle.seal.captureId))) throw new Error("INVALID_EVIDENCE_BUNDLE");
  for (const [index, record] of bundle.records.entries()) {
    if (!record || record.index !== index || !nonempty(record.recordType) || !validHash(record.payloadHash) ||
        (record.previousEventHash !== null && !validHash(record.previousEventHash)) ||
        !nonempty(record.keyId) || !validBase64(record.signatureB64)) throw new Error("INVALID_EVIDENCE_BUNDLE");
  }
}

export async function verifyEvidenceBundle(
  bundle: EvidenceBundleV1,
  trustedKeys: ReadonlyMap<string, CryptoKey>
): Promise<void> {
  verifyBundleShape(bundle);
  let previousEventHash: Sha256 | null = null;
  for (const record of bundle.records) {
    if (record.previousEventHash !== previousEventHash) throw new Error("BUNDLE_CHAIN_MISMATCH");
    const payload = canonicalize(record.payload);
    if (payload === undefined || await sha256(payload) !== record.payloadHash) throw new Error("BUNDLE_PAYLOAD_HASH_MISMATCH");

    const signedRecord = {
      bundleId: bundle.bundleId,
      index: record.index,
      recordType: record.recordType,
      payloadHash: record.payloadHash,
      previousEventHash: record.previousEventHash,
      keyId: record.keyId
    };
    await verifySignature(signedRecord, record.signatureB64, record.keyId, trustedKeys);
    const event = canonicalize({ ...signedRecord, signatureB64: record.signatureB64 });
    if (event === undefined) throw new Error("INVALID_EVIDENCE_BUNDLE");
    previousEventHash = await sha256(event);
  }

  if (bundle.seal.terminalEventHash !== previousEventHash) throw new Error("BUNDLE_TERMINAL_HASH_MISMATCH");
  const { signatureB64, ...signedSeal } = bundle.seal;
  await verifySignature(signedSeal, signatureB64, bundle.seal.keyId, trustedKeys);
}

async function verifySignature(
  value: unknown,
  signatureB64: string,
  keyId: string,
  trustedKeys: ReadonlyMap<string, CryptoKey>
): Promise<void> {
  const key = trustedKeys.get(keyId);
  if (!key) throw new Error("BUNDLE_UNTRUSTED_KEY");
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new Error("INVALID_EVIDENCE_BUNDLE");
  let valid = false;
  try {
    const signature = decodeBase64(signatureB64);
    if (signature.byteLength !== 64) throw new Error("INVALID_ES256_SIGNATURE");
    const signatureBuffer = new ArrayBuffer(signature.byteLength);
    new Uint8Array(signatureBuffer).set(signature);
    const message = new TextEncoder().encode(canonical);
    const messageBuffer = new ArrayBuffer(message.byteLength);
    new Uint8Array(messageBuffer).set(message);
    valid = await globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, signatureBuffer, messageBuffer
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("BUNDLE_SIGNATURE_INVALID");
}

async function sign(value: unknown, privateKey: CryptoKey): Promise<string> {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new Error("INVALID_BUNDLE_CREATION_INPUT");
  const message = new TextEncoder().encode(canonical);
  const messageBuffer = new ArrayBuffer(message.byteLength);
  new Uint8Array(messageBuffer).set(message);
  try {
    const signature = new Uint8Array(await globalThis.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, privateKey, messageBuffer
    ));
    if (signature.byteLength !== 64) throw new Error("INVALID_BUNDLE_SIGNING_KEY");
    return btoa(String.fromCharCode(...signature));
  } catch {
    throw new Error("BUNDLE_SIGNING_FAILED");
  }
}

function decodeBase64(value: string): Uint8Array {
  if (!validBase64(value)) throw new Error("INVALID_EVIDENCE_BUNDLE");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validBase64(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function validHash(value: unknown): value is Sha256 {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(value: object, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
