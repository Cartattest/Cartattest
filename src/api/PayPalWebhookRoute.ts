import type { PayPalWebhookHeaders } from "../paypal/OrdersV2Gateway.js";
import type { SqlPool } from "../persistence/CaptureAttemptRepository.js";
import { processPayPalWebhook, type PayPalWebhookVerifier } from "../application/PayPalWebhookService.js";

const maxBodyBytes = 1_000_000;

export async function handlePayPalWebhookRequest(
  request: Request,
  dependencies: { webhookId: string; verifier: PayPalWebhookVerifier; pool: SqlPool; now?: () => Date }
): Promise<Response> {
  if (new URL(request.url).pathname !== "/api/webhooks/paypal") return json({ error: "NOT_FOUND" }, 404);
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  if (!request.body) return json({ error: "INVALID_PAYPAL_WEBHOOK_BODY" }, 400);

  let rawBody: string;
  try { rawBody = await readBody(request.body); }
  catch (error) {
    if (error instanceof Error && error.message === "PAYPAL_WEBHOOK_BODY_TOO_LARGE") return json({ error: error.message }, 413);
    return json({ error: "INVALID_PAYPAL_WEBHOOK_BODY" }, 400);
  }

  const headers: PayPalWebhookHeaders = {};
  copyHeader(request.headers, headers, "paypal-auth-algo");
  copyHeader(request.headers, headers, "paypal-cert-url");
  copyHeader(request.headers, headers, "paypal-transmission-id");
  copyHeader(request.headers, headers, "paypal-transmission-sig");
  copyHeader(request.headers, headers, "paypal-transmission-time");
  try {
    const result = await processPayPalWebhook(rawBody, headers, dependencies);
    return json({ received: true, result }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PAYPAL_WEBHOOK_FAILED";
    if (["INVALID_PAYPAL_WEBHOOK_BODY", "INVALID_PAYPAL_WEBHOOK_EVENT", "PAYPAL_WEBHOOK_SIGNATURE_INVALID", "PAYPAL_WEBHOOK_HEADERS_INVALID"]
      .includes(message)) return json({ error: message }, 400);
    if (message === "WEBHOOK_EVENT_ID_CONFLICT" || message === "WEBHOOK_CAPTURE_ID_MISMATCH") {
      return json({ error: message }, 409);
    }
    return json({ error: "PAYPAL_WEBHOOK_FAILED" }, 502);
  }
}

async function readBody(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel();
        throw new Error("PAYPAL_WEBHOOK_BODY_TOO_LARGE");
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

function copyHeader(source: Headers, target: PayPalWebhookHeaders, name: keyof PayPalWebhookHeaders): void {
  const value = source.get(name);
  if (value !== null) target[name] = value;
}
