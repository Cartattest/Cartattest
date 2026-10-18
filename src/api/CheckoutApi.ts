import type { SelectionAdmissionDependencies } from "../application/SelectionAdmissionEvaluator.js";
import { evaluateSelectionAdmission } from "../application/SelectionAdmissionEvaluator.js";
import { createOrderAfterAdmission } from "../application/SelectionCheckoutService.js";
import { completeCheckout } from "../application/CompleteCheckoutService.js";
import { handlePayPalWebhookRequest } from "./PayPalWebhookRoute.js";
import type { PayPalGateway } from "../ports/PayPalGateway.js";
import type { PayPalWebhookVerifier } from "../application/PayPalWebhookService.js";
import type { SqlPool } from "../persistence/CaptureAttemptRepository.js";
import { loadClaimSet, saveClaimSet } from "../persistence/ClaimSetRepository.js";
import { loadCheckoutStatus } from "../persistence/AdmissionRepository.js";

const maxRequestBytes = 128_000;

export interface CheckoutApiDependencies {
  pool: SqlPool;
  gateway: PayPalGateway & PayPalWebhookVerifier;
  selection: Omit<SelectionAdmissionDependencies, "loadClaimSet">;
  webhookId: string;
  policyVersion: string;
}

export async function handleCheckoutApiRequest(request: Request, dependencies: CheckoutApiDependencies): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/api/webhooks/paypal") {
    return handlePayPalWebhookRequest(request, {
      webhookId: dependencies.webhookId, verifier: dependencies.gateway, pool: dependencies.pool,
      ...(dependencies.selection.now ? { now: dependencies.selection.now } : {})
    });
  }
  const statusMatch = /^\/api\/checkouts\/([^/]+)$/.exec(path);
  if (statusMatch) {
    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
    let admissionId: string;
    try { admissionId = decodeURIComponent(statusMatch[1]!); }
    catch { return json({ error: "INVALID_ADMISSION_ID" }, 400); }
    try { return json(await loadCheckoutStatus(dependencies.pool, admissionId), 200); }
    catch (error) {
      const message = error instanceof Error ? error.message : "CHECKOUT_FAILED";
      if (message === "INVALID_ADMISSION_ID") return json({ error: message }, 400);
      if (message === "ADMISSION_NOT_FOUND") return json({ error: message }, 404);
      return json({ error: "CHECKOUT_FAILED" }, 500);
    }
  }
  const methods: Record<string, string> = {
    "/api/claim-sets": "POST", "/api/selections": "POST", "/api/checkout/complete": "POST"
  };
  const expectedMethod = methods[path];
  if (!expectedMethod) return json({ error: "NOT_FOUND" }, 404);
  if (request.method !== expectedMethod) return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: expectedMethod });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  let body: unknown;
  try { body = JSON.parse(await readBody(request)); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ error: code === "REQUEST_BODY_TOO_LARGE" ? code : "INVALID_JSON" }, code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400);
  }

  try {
    if (path === "/api/claim-sets") {
      const claimSetHash = await saveClaimSet(dependencies.pool, body);
      return json({ status: "STORED", claimSetId: (body as { claimSetId: string }).claimSetId, claimSetHash }, 201);
    }
    if (path === "/api/selections") {
      const evaluation = await evaluateSelectionAdmission(body, {
        ...dependencies.selection,
        loadClaimSet: (claimSetId) => loadClaimSet(dependencies.pool, claimSetId)
      });
      if (evaluation.outcome.status === "BLOCK") return json({ status: "BLOCKED", reason: evaluation.outcome.reason }, 200);
      if (evaluation.outcome.status === "STEP_UP") return json({ status: "STEP_UP", claimIds: evaluation.outcome.claimIds }, 200);
      const checkout = await createOrderAfterAdmission(evaluation, {
        pool: dependencies.pool, gateway: dependencies.gateway, newId: dependencies.selection.newId,
        policyVersion: dependencies.policyVersion,
        ...(dependencies.selection.now ? { now: dependencies.selection.now } : {})
      });
      if (!("admissionId" in checkout)) throw new Error("INVALID_ADMISSION_EVALUATION");
      return json({ status: "ALLOWED", admissionId: checkout.admissionId, approvalUrl: checkout.approvalUrl }, 200);
    }
    const result = await completeCheckout(body, {
      pool: dependencies.pool, gateway: dependencies.gateway, newId: dependencies.selection.newId,
      ...(dependencies.selection.now ? { now: dependencies.selection.now } : {})
    });
    return json({ state: result.state, ...(result.paypalCaptureId ? { captureId: result.paypalCaptureId } : {}),
      ...(result.paypalCaptureStatus ? { captureStatus: result.paypalCaptureStatus } : {}) }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CHECKOUT_FAILED";
    if (message === "CLAIM_SET_ID_CONFLICT") return json({ error: message }, 409);
    if (message.startsWith("INVALID_")) return json({ error: message }, 400);
    if (["CLAIM_SET_NOT_FOUND", "ADMISSION_NOT_CAPTUREABLE", "CAPTURE_ATTEMPT_NOT_FOUND"].includes(message)) {
      return json({ error: message }, 404);
    }
    if (["CART_BINDING_MISMATCH", "PAYPAL_ORDER_NOT_APPROVED", "ATTESTATION_BINDING_MISMATCH"].includes(message)) {
      return json({ error: message }, 409);
    }
    return json({ error: "CHECKOUT_FAILED" }, 500);
  }
}

async function readBody(request: Request): Promise<string> {
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxRequestBytes) {
        await reader.cancel();
        throw new Error("REQUEST_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function json(value: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders } });
}
