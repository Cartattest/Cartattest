import canonicalize from "canonicalize";
import type { BuyerOverrideV1, ClaimSetV1, Es256Signature } from "../domain/types.js";

export async function verifyClaimSetSignature(
  claimSet: ClaimSetV1,
  trustedKeys: ReadonlyMap<string, CryptoKey>
): Promise<boolean> {
  if (!claimSet.buyerSignature) return false;
  const { buyerSignature, ...payload } = claimSet;
  return verify(payload, buyerSignature, trustedKeys);
}

export async function verifyBuyerOverrideSignature(
  override: BuyerOverrideV1,
  trustedKeys: ReadonlyMap<string, CryptoKey>
): Promise<boolean> {
  const { buyerSignature, ...payload } = override;
  return verify(payload, buyerSignature, trustedKeys);
}

async function verify(
  payload: unknown,
  signature: Es256Signature,
  trustedKeys: ReadonlyMap<string, CryptoKey>
): Promise<boolean> {
  if (!signature || signature.alg !== "ES256" || !signature.keyId ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/.test(signature.signatureB64)) return false;
  const key = trustedKeys.get(signature.keyId);
  if (!key || key.algorithm.name !== "ECDSA" || !("namedCurve" in key.algorithm) ||
      key.algorithm.namedCurve !== "P-256" || !key.usages.includes("verify")) return false;
  const canonical = canonicalize(payload);
  if (canonical === undefined) return false;

  try {
    const raw = Uint8Array.from(atob(signature.signatureB64), (character) => character.charCodeAt(0));
    if (raw.byteLength !== 64) return false;
    const signatureBuffer = new ArrayBuffer(raw.byteLength);
    new Uint8Array(signatureBuffer).set(raw);
    const message = new TextEncoder().encode(canonical);
    const messageBuffer = new ArrayBuffer(message.byteLength);
    new Uint8Array(messageBuffer).set(message);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signatureBuffer, messageBuffer);
  } catch {
    return false;
  }
}
