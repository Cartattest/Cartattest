import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ReplayPayPalGateway } from "../dist/paypal/ReplayPayPalGateway.js";
import { assertBindingEqual, mapPayPalOrderToBinding } from "../dist/binding/CartBindingV1.js";

const binding = JSON.parse(await readFile(new URL("../fixtures/paypal/gate0-binding.example.json", import.meta.url), "utf8"));
const observation = JSON.parse(await readFile(new URL("../fixtures/paypal/sanitized/g0-01-approved-capture.json", import.meta.url), "utf8"));
const scenario = { approvalRequired: observation.observations.approvalRequired,
  approvedOrderStatus: observation.observations.approvedOrderStatus, captureStatus: observation.observations.captureStatus };

test("replays create, explicit approval, Binding B, and one idempotent capture", async () => {
  const gateway = new ReplayPayPalGateway(scenario);
  const created = await gateway.createOrder(binding);
  assert.equal(created.orderId, "REPLAY-ORDER-1");
  assert.equal(created.orderStatus, "CREATED");
  assert.equal(new URL(created.approvalUrl, "https://service.example").pathname, "/replay/approve");
  assertBindingEqual(binding, mapPayPalOrderToBinding(created.raw, binding.shipping.preference));
  assert.equal((await gateway.getOrder(created.orderId)).orderStatus, "CREATED");
  await assert.rejects(gateway.captureOrder(created.orderId, "request-1"), { message: "PAYPAL_ORDER_NOT_APPROVED" });
  await gateway.approveOrder(created.orderId);
  assert.equal((await gateway.getOrder(created.orderId)).orderStatus, "APPROVED");
  const captured = await gateway.captureOrder(created.orderId, "request-1");
  assert.equal(captured.captureStatus, "COMPLETED");
  assert.deepEqual(await gateway.captureOrder(created.orderId, "request-1"), captured);
  await assert.rejects(gateway.captureOrder(created.orderId, "request-2"), { message: "PAYPAL_DUPLICATE_CAPTURE" });
  assert.equal((await gateway.getOrder(created.orderId)).orderStatus, "COMPLETED");
});

test("rejects unknown orders and approval after terminal capture", async () => {
  const gateway = new ReplayPayPalGateway(scenario);
  await assert.rejects(gateway.getOrder("REPLAY-UNKNOWN"), { message: "PAYPAL_ORDER_NOT_FOUND" });
  const order = await gateway.createOrder(binding);
  await gateway.approveOrder(order.orderId);
  await gateway.captureOrder(order.orderId, "request-1");
  await assert.rejects(gateway.approveOrder(order.orderId), { message: "PAYPAL_ORDER_NOT_APPROVABLE" });
});
