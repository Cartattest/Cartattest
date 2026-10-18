import { readFile } from "node:fs/promises";
import { OrdersV2Gateway } from "../dist/paypal/OrdersV2Gateway.js";

const [action, ...args] = process.argv.slice(2);
if (process.env.PAYPAL_ENV === "live") throw new Error("GATE0_SANDBOX_ONLY");
const gateway = new OrdersV2Gateway({
  clientId: required("PAYPAL_CLIENT_ID"),
  clientSecret: required("PAYPAL_CLIENT_SECRET"),
  environment: "sandbox"
});

if (action === "create" && args[0]) {
  const binding = JSON.parse(await readFile(args[0], "utf8"));
  const order = await gateway.createOrder(binding);
  console.log(JSON.stringify({ orderId: order.orderId, status: order.orderStatus, approvalUrl: order.approvalUrl }, null, 2));
} else if (action === "get" && args[0]) {
  const order = await gateway.getOrder(args[0]);
  console.log(JSON.stringify({ orderId: order.orderId, status: order.orderStatus }, null, 2));
} else if (action === "capture" && args[0] && args[1]) {
  const result = await gateway.captureOrder(args[0], args[1]);
  console.log(JSON.stringify({ orderId: result.orderId, captureId: result.captureId, captureStatus: result.captureStatus }, null, 2));
} else {
  console.error("Usage: npm run gate0 -- create <binding.json> | get <order-id> | capture <order-id> <persisted-request-id>");
  process.exitCode = 2;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
