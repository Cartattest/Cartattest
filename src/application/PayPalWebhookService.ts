import type { PayPalWebhookHeaders } from "../paypal/OrdersV2Gateway.js";
import type { SqlPool } from "../persistence/CaptureAttemptRepository.js";
import { recordVerifiedPayPalWebhook } from "../persistence/PayPalWebhookRepository.js";

export interface PayPalWebhookVerifier {
  verifyWebhookSignature(webhookId: string, headers: PayPalWebhookHeaders, event: unknown): Promise<boolean>;
}

export async function processPayPalWebhook(
  rawBody: string,
  headers: PayPalWebhookHeaders,
  dependencies: { webhookId: string; verifier: PayPalWebhookVerifier; pool: SqlPool; now?: () => Date }
): Promise<"APPLIED" | "RECORDED" | "DUPLICATE"> {
  if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) throw new Error("PAYPAL_WEBHOOK_BODY_TOO_LARGE");
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { throw new Error("INVALID_PAYPAL_WEBHOOK_BODY"); }
  if (!isRecord(payload)) throw new Error("INVALID_PAYPAL_WEBHOOK_BODY");
  if (!await dependencies.verifier.verifyWebhookSignature(dependencies.webhookId, headers, payload)) {
    throw new Error("PAYPAL_WEBHOOK_SIGNATURE_INVALID");
  }
  if (!nonempty(payload.id) || !nonempty(payload.event_type)) throw new Error("INVALID_PAYPAL_WEBHOOK_EVENT");
  const resource = isRecord(payload.resource) ? payload.resource : {};
  const related = isRecord(resource.supplementary_data) && isRecord(resource.supplementary_data.related_ids)
    ? resource.supplementary_data.related_ids : {};
  const now = dependencies.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("INVALID_POLICY_TIME");
  return recordVerifiedPayPalWebhook(dependencies.pool, {
    eventId: payload.id,
    eventType: payload.event_type,
    ...(nonempty(related.order_id) ? { orderId: related.order_id } : {}),
    ...(nonempty(resource.id) ? { captureId: resource.id } : {}),
    ...(nonempty(resource.status) ? { captureStatus: resource.status } : {}),
    verifiedAt: now.toISOString()
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
