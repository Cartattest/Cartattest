import type { CartBindingV1 } from "../domain/types.js";

export interface PayPalOrderSnapshot {
  orderId: string;
  orderStatus: string;
  approvalUrl?: string;
  raw: unknown;
}

export interface CaptureResult {
  httpStatus: number;
  orderId: string;
  captureId?: string;
  captureStatus?: "COMPLETED" | "DECLINED" | "PENDING" | "FAILED";
  raw: unknown;
}

export interface PayPalGateway {
  createOrder(binding: CartBindingV1): Promise<PayPalOrderSnapshot>;
  getOrder(orderId: string): Promise<PayPalOrderSnapshot>;
  captureOrder(orderId: string, paypalRequestId: string): Promise<CaptureResult>;
}
