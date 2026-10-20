import type { CaptureResult, PayPalGateway, PayPalOrderSnapshot } from "../ports/PayPalGateway.js";
import type { CartBindingV1 } from "../domain/types.js";

interface ReplayOrder {
  binding: CartBindingV1;
  status: "CREATED" | "APPROVED" | "COMPLETED";
  capture?: CaptureResult;
}

export interface ReplayPayPalScenario {
  approvalRequired: true;
  approvedOrderStatus: "APPROVED";
  captureStatus: "COMPLETED";
}

/** Deterministic local PayPal stand-in; it never makes network requests or asserts live observations. */
export class ReplayPayPalGateway implements PayPalGateway {
  private readonly orders = new Map<string, ReplayOrder>();
  private nextOrder = 1;

  constructor(private readonly scenario: ReplayPayPalScenario) {
    if (scenario.approvalRequired !== true || scenario.approvedOrderStatus !== "APPROVED" || scenario.captureStatus !== "COMPLETED") {
      throw new Error("REPLAY_SCENARIO_UNSUPPORTED");
    }
  }

  async createOrder(binding: CartBindingV1): Promise<PayPalOrderSnapshot> {
    const orderId = `REPLAY-ORDER-${this.nextOrder++}`;
    const order: ReplayOrder = { binding: structuredClone(binding), status: "CREATED" };
    this.orders.set(orderId, order);
    return {
      orderId, orderStatus: order.status,
      approvalUrl: `/replay/approve?token=${encodeURIComponent(orderId)}`,
      raw: orderPayload(orderId, order)
    };
  }

  async getOrder(orderId: string): Promise<PayPalOrderSnapshot> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("PAYPAL_ORDER_NOT_FOUND");
    return { orderId, orderStatus: order.status, raw: orderPayload(orderId, order) };
  }

  async approveOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("PAYPAL_ORDER_NOT_FOUND");
    if (order.status === "APPROVED") return;
    if (order.status !== "CREATED") throw new Error("PAYPAL_ORDER_NOT_APPROVABLE");
    order.status = "APPROVED";
  }

  async captureOrder(orderId: string, paypalRequestId: string): Promise<CaptureResult> {
    if (!paypalRequestId.trim()) throw new Error("INVALID_PAYPAL_REQUEST_ID");
    const order = this.orders.get(orderId);
    if (!order) throw new Error("PAYPAL_ORDER_NOT_FOUND");
    if (order.capture) {
      if (order.capture.raw && isRecord(order.capture.raw) && order.capture.raw.paypalRequestId === paypalRequestId) return structuredClone(order.capture);
      throw new Error("PAYPAL_DUPLICATE_CAPTURE");
    }
    if (!this.scenario.approvalRequired || order.status !== this.scenario.approvedOrderStatus) throw new Error("PAYPAL_ORDER_NOT_APPROVED");
    const captureId = `${orderId}-CAPTURE-1`;
    order.status = this.scenario.captureStatus;
    order.capture = {
      httpStatus: 201, orderId, captureId, captureStatus: this.scenario.captureStatus,
      raw: { id: captureId, status: this.scenario.captureStatus, paypalRequestId }
    };
    return structuredClone(order.capture);
  }
}

function orderPayload(orderId: string, order: ReplayOrder): Record<string, unknown> {
  const binding = order.binding;
  const money = (value: string) => ({ currency_code: binding.currency, value });
  const address = binding.shipping.address;
  const capture = order.capture?.raw;
  return {
    id: orderId,
    intent: binding.intent,
    status: order.status,
    application_context: { shipping_preference: binding.shipping.preference },
    payment_source: { paypal: { experience_context: { shipping_preference: binding.shipping.preference } } },
    purchase_units: [{
      payee: binding.payee.identityType === "EMAIL"
        ? { email_address: binding.payee.identityValue } : { merchant_id: binding.payee.identityValue },
      amount: { currency_code: binding.currency, value: binding.amountBreakdown.total, breakdown: {
        item_total: money(binding.amountBreakdown.itemTotal), tax_total: money(binding.amountBreakdown.taxTotal),
        shipping: money(binding.amountBreakdown.shipping), handling: money(binding.amountBreakdown.handling),
        insurance: money(binding.amountBreakdown.insurance), shipping_discount: money(binding.amountBreakdown.shippingDiscount),
        discount: money(binding.amountBreakdown.discount)
      } },
      shipping: { name: { full_name: binding.shipping.name }, address: {
        address_line_1: address.addressLine1, ...(address.addressLine2 ? { address_line_2: address.addressLine2 } : {}),
        admin_area_2: address.adminArea2, ...(address.adminArea1 ? { admin_area_1: address.adminArea1 } : {}),
        postal_code: address.postalCode, country_code: address.countryCode
      }, ...(binding.shipping.optionId ? { options: [{ id: binding.shipping.optionId, type: binding.shipping.type,
        amount: money(binding.shipping.amount), selected: true }] } : {}) },
      items: binding.items.map((item) => ({ name: item.name, sku: item.sku, quantity: item.quantity,
        unit_amount: money(item.unitAmount), tax: money(item.tax) })),
      ...(capture ? { payments: { captures: [capture] } } : {})
    }]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
