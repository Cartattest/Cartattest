import type { CartBindingV1 } from "../domain/types.js";
import type { CaptureResult, PayPalGateway, PayPalOrderSnapshot } from "../ports/PayPalGateway.js";

export interface PayPalGatewayConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "live";
  returnUrl?: string;
  cancelUrl?: string;
  fetch?: typeof fetch;
}

export interface PayPalWebhookHeaders {
  "paypal-auth-algo"?: string;
  "paypal-cert-url"?: string;
  "paypal-transmission-id"?: string;
  "paypal-transmission-sig"?: string;
  "paypal-transmission-time"?: string;
}

type OAuthToken = { access_token: string; expires_in: number };
type PayPalOrderResponse = {
  id?: string;
  status?: string;
  links?: Array<{ rel?: string; href?: string }>;
  purchase_units?: Array<{ payments?: { captures?: Array<{ id?: string; status?: string }> } }>;
  [key: string]: unknown;
};

/** Server-side PayPal Orders v2 adapter. Credentials must never be sent to a browser. */
export class OrdersV2Gateway implements PayPalGateway {
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  private token?: { value: string; expiresAt: number };
  private tokenRequest: Promise<string> | undefined;

  constructor(private readonly config: PayPalGatewayConfig) {
    if (!config.clientId || !config.clientSecret) throw new Error("PAYPAL_CREDENTIALS_REQUIRED");
    if (Boolean(config.returnUrl) !== Boolean(config.cancelUrl)) throw new Error("PAYPAL_RETURN_URLS_REQUIRED");
    this.baseUrl = config.environment === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
    this.request = config.fetch ?? fetch;
  }

  async createOrder(binding: CartBindingV1): Promise<PayPalOrderSnapshot> {
    assertSupportedBinding(binding);
    const unit = binding.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unit_amount: { currency_code: binding.currency, value: item.unitAmount },
      tax: { currency_code: binding.currency, value: item.tax }
    }));
    const response = await this.api<PayPalOrderResponse>("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": crypto.randomUUID() },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: {
            currency_code: binding.currency,
            value: binding.amountBreakdown.total,
            breakdown: {
              item_total: money(binding, binding.amountBreakdown.itemTotal),
              tax_total: money(binding, binding.amountBreakdown.taxTotal),
              shipping: money(binding, binding.amountBreakdown.shipping),
              handling: money(binding, binding.amountBreakdown.handling),
              insurance: money(binding, binding.amountBreakdown.insurance),
              shipping_discount: money(binding, binding.amountBreakdown.shippingDiscount),
              discount: money(binding, binding.amountBreakdown.discount)
            }
          },
          items: unit,
          shipping: {
            name: { full_name: binding.shipping.name },
            address: paypalAddress(binding.shipping.address)
          },
          payee: binding.payee.identityType === "MERCHANT_ID"
            ? { merchant_id: binding.payee.identityValue }
            : { email_address: binding.payee.identityValue }
        }],
        payment_source: {
          paypal: {
            experience_context: {
              shipping_preference: "SET_PROVIDED_ADDRESS",
              user_action: "PAY_NOW",
              ...(this.config.returnUrl ? { return_url: this.config.returnUrl } : {}),
              ...(this.config.cancelUrl ? { cancel_url: this.config.cancelUrl } : {})
            }
          }
        }
      })
    });
    return snapshot(response);
  }

  async getOrder(orderId: string): Promise<PayPalOrderSnapshot> {
    assertOrderId(orderId);
    return snapshot(await this.api<PayPalOrderResponse>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" }));
  }

  async captureOrder(orderId: string, paypalRequestId: string): Promise<CaptureResult> {
    assertOrderId(orderId);
    if (!paypalRequestId.trim()) throw new Error("PAYPAL_REQUEST_ID_REQUIRED");
    const { body: response, status: httpStatus } = await this.apiWithStatus<PayPalOrderResponse>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: { "PayPal-Request-Id": paypalRequestId },
      body: "{}"
    });
    const capture = response.purchase_units?.[0]?.payments?.captures?.[0];
    const status = capture?.status;
    return {
      httpStatus,
      orderId: response.id ?? orderId,
      ...(capture?.id ? { captureId: capture.id } : {}),
      ...(status === "COMPLETED" || status === "DECLINED" || status === "PENDING" || status === "FAILED"
        ? { captureStatus: status }
        : {}),
      raw: response
    };
  }

  async verifyWebhookSignature(webhookId: string, headers: PayPalWebhookHeaders, webhookEvent: unknown): Promise<boolean> {
    const { "paypal-auth-algo": authAlgo, "paypal-cert-url": certUrl,
      "paypal-transmission-id": transmissionId, "paypal-transmission-sig": transmissionSig,
      "paypal-transmission-time": transmissionTime } = headers;
    if (!nonempty(webhookId) || !nonempty(authAlgo) || !nonempty(certUrl) || !nonempty(transmissionId) ||
        !nonempty(transmissionSig) || !nonempty(transmissionTime)) {
      throw new Error("PAYPAL_WEBHOOK_HEADERS_INVALID");
    }
    let certificate: URL;
    try { certificate = new URL(certUrl); } catch { throw new Error("PAYPAL_WEBHOOK_HEADERS_INVALID"); }
    const paypalHosts = this.config.environment === "sandbox"
      ? ["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"]
      : ["api.paypal.com", "api-m.paypal.com"];
    if (certificate.protocol !== "https:" || !paypalHosts.includes(certificate.hostname) || certificate.port ||
        certificate.username || certificate.password || !certificate.pathname.startsWith("/v1/notifications/certs/")) {
      throw new Error("PAYPAL_WEBHOOK_HEADERS_INVALID");
    }
    const result = await this.api<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: webhookEvent
      })
    });
    return result.verification_status === "SUCCESS";
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      const basic = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
      const response = await this.request(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials"
      });
      const body = await response.json() as Partial<OAuthToken>;
      if (!response.ok || typeof body.access_token !== "string" || !body.access_token.trim() ||
          typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
        throw new Error(`PAYPAL_OAUTH_FAILED ${response.status} ${safeError(body)}`);
      }
      this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
      return body.access_token;
    })();
    try { return await this.tokenRequest; }
    finally { this.tokenRequest = undefined; }
  }

  private async api<T>(path: string, init: RequestInit): Promise<T> {
    return (await this.apiWithStatus<T>(path, init)).body;
  }

  private async apiWithStatus<T>(path: string, init: RequestInit): Promise<{ body: T; status: number }> {
    const token = await this.accessToken();
    const response = await this.request(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`PAYPAL_API_FAILED ${response.status} ${safeError(body)}`);
    return { body: body as T, status: response.status };
  }
}

function assertSupportedBinding(binding: CartBindingV1): void {
  if (binding.schemaVersion !== "cart-binding-v1" || binding.intent !== "CAPTURE" || binding.purchaseUnitCount !== 1) {
    throw new Error("UNSUPPORTED_CART_BINDING");
  }
  if (!binding.items.length) throw new Error("CART_ITEMS_REQUIRED");
  if (binding.shipping.preference !== "SET_PROVIDED_ADDRESS") throw new Error("FIXED_SHIPPING_REQUIRED");
}

function snapshot(order: PayPalOrderResponse): PayPalOrderSnapshot {
  if (!order.id || !order.status) throw new Error("PAYPAL_ORDER_RESPONSE_INVALID");
  const approval = order.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href;
  return { orderId: order.id, orderStatus: order.status, ...(approval ? { approvalUrl: approval } : {}), raw: order };
}

function money(binding: CartBindingV1, value: string) {
  return { currency_code: binding.currency, value };
}

function paypalAddress(address: CartBindingV1["shipping"]["address"]) {
  return {
    address_line_1: address.addressLine1,
    ...(address.addressLine2 ? { address_line_2: address.addressLine2 } : {}),
    admin_area_2: address.adminArea2,
    ...(address.adminArea1 ? { admin_area_1: address.adminArea1 } : {}),
    postal_code: address.postalCode,
    country_code: address.countryCode
  };
}

function assertOrderId(orderId: string): void {
  if (!/^[A-Z0-9-]{1,64}$/.test(orderId)) throw new Error("INVALID_PAYPAL_ORDER_ID");
}

function safeError(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown response";
  const body = value as Record<string, unknown>;
  const details = Array.isArray(body.details)
    ? body.details.flatMap((detail) => {
      if (!detail || typeof detail !== "object") return [];
      const item = detail as Record<string, unknown>;
      return [typeof item.issue === "string" ? `${item.issue}${typeof item.field === "string" ? `@${item.field}` : ""}` : ""];
    }).filter(Boolean).join(",")
    : "";
  return [body.name ?? body.error ?? body.message ?? "unknown response", details && `details=${details}`]
    .filter(Boolean).join(" ").slice(0, 300);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
