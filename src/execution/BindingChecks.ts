import type { CartBindingV1 } from "../domain/types.js";
import { assertBindingEqual, mapPayPalOrderToBinding } from "../binding/CartBindingV1.js";
import type { PayPalGateway, PayPalOrderSnapshot } from "../ports/PayPalGateway.js";

export async function createOrderWithBindingA(
  gateway: PayPalGateway,
  admittedBinding: CartBindingV1
): Promise<{ orderId: string; approvalUrl: string }> {
  const created = await gateway.createOrder(admittedBinding);
  if (created.orderStatus !== "CREATED") throw new Error("PAYPAL_ORDER_NOT_CREATED");
  const current = await gateway.getOrder(created.orderId);
  assertOrderMatches(current, created.orderId, "CREATED", admittedBinding);
  if (!created.approvalUrl) throw new Error("PAYPAL_APPROVAL_LINK_MISSING");
  return { orderId: created.orderId, approvalUrl: created.approvalUrl };
}

export async function checkApprovedOrderBinding(
  gateway: PayPalGateway,
  orderId: string,
  admittedBinding: CartBindingV1,
  admissionExpiresAt: string,
  now = Date.now()
): Promise<void> {
  const expiry = Date.parse(admissionExpiresAt);
  if (!Number.isFinite(expiry) || now >= expiry) throw new Error("ADMISSION_EXPIRED");
  const current = await gateway.getOrder(orderId);
  assertOrderMatches(current, orderId, "APPROVED", admittedBinding);
}

function assertOrderMatches(
  current: PayPalOrderSnapshot,
  expectedOrderId: string,
  expectedStatus: string,
  admittedBinding: CartBindingV1
): void {
  if (current.orderId !== expectedOrderId) throw new Error("PAYPAL_ORDER_ID_MISMATCH");
  if (current.orderStatus !== expectedStatus) {
    throw new Error(expectedStatus === "APPROVED" ? "PAYPAL_ORDER_NOT_APPROVED" : "PAYPAL_ORDER_NOT_CREATED");
  }
  assertBindingEqual(admittedBinding, mapPayPalOrderToBinding(current.raw));
}
