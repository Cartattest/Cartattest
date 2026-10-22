import { readFile } from "node:fs/promises";
import { OrdersV2Gateway } from "../dist/paypal/OrdersV2Gateway.js";
import { patchSandboxOrder } from "./gate0-patch.mjs";

const [action, ...args] = process.argv.slice(2);
if (process.env.PAYPAL_ENV === "live") throw new Error("GATE0_SANDBOX_ONLY");
if (action === "create" && (!process.env.PAYPAL_RETURN_URL || !process.env.PAYPAL_CANCEL_URL)) {
  throw new Error("PAYPAL_RETURN_URLS_REQUIRED");
}
const gateway = new OrdersV2Gateway({
  clientId: required("PAYPAL_CLIENT_ID"),
  clientSecret: required("PAYPAL_CLIENT_SECRET"),
  environment: "sandbox",
  ...(process.env.PAYPAL_RETURN_URL ? { returnUrl: process.env.PAYPAL_RETURN_URL } : {}),
  ...(process.env.PAYPAL_CANCEL_URL ? { cancelUrl: process.env.PAYPAL_CANCEL_URL } : {})
});

if (action === "create" && args[0]) {
  const binding = JSON.parse(await readFile(args[0], "utf8"));
  if (binding.payee?.identityType === "EMAIL" && binding.payee.identityValue === "REPLACE_WITH_SANDBOX_BUSINESS_EMAIL") {
    binding.payee.identityValue = required("PAYPAL_MERCHANT_EMAIL");
  }
  const order = await gateway.createOrder(binding);
  console.log(JSON.stringify({ orderId: order.orderId, status: order.orderStatus, approvalUrl: order.approvalUrl }, null, 2));
} else if (action === "get" && args[0]) {
  const order = await gateway.getOrder(args[0]);
  console.log(JSON.stringify({ orderId: order.orderId, status: order.orderStatus, approvalUrl: order.approvalUrl }, null, 2));
} else if (action === "capture" && args[0] && args[1]) {
  const result = await gateway.captureOrder(args[0], args[1]);
  console.log(JSON.stringify({ orderId: result.orderId, captureId: result.captureId, captureStatus: result.captureStatus }, null, 2));
} else if (action === "patch" && args[0] && args[1]) {
  const patchOperations = JSON.parse(await readFile(args[1], "utf8"));
  const result = await patchSandboxOrder({
    clientId: required("PAYPAL_CLIENT_ID"),
    clientSecret: required("PAYPAL_CLIENT_SECRET"),
    orderId: args[0],
    patchOperations
  });
  console.log(JSON.stringify({ orderId: args[0], status: result.status }, null, 2));
} else {
  console.error("Usage: npm run gate0 -- create <binding.json> | get <order-id> | capture <order-id> <persisted-request-id> | patch <order-id> <patch.json>");
  process.exitCode = 2;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
