const sandboxUrl = "https://api-m.sandbox.paypal.com";

export async function patchSandboxOrder({ clientId, clientSecret, orderId, patchOperations, fetch: request = fetch }) {
  if (!/^[A-Z0-9-]{1,64}$/.test(orderId)) throw new Error("INVALID_PAYPAL_ORDER_ID");
  if (!Array.isArray(patchOperations) || patchOperations.length === 0) {
    throw new Error("PAYPAL_PATCH_OPERATIONS_REQUIRED");
  }
  if (patchOperations.some((patch) => !isPatchOperation(patch))) {
    throw new Error("PAYPAL_PATCH_OPERATION_INVALID");
  }

  const tokenResponse = await request(`${sandboxUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const tokenBody = await tokenResponse.json().catch(() => undefined);
  if (!tokenResponse.ok || typeof tokenBody?.access_token !== "string" || !tokenBody.access_token.trim() ||
      typeof tokenBody.expires_in !== "number" || !Number.isFinite(tokenBody.expires_in) || tokenBody.expires_in <= 0) {
    throw new Error(`PAYPAL_OAUTH_FAILED ${tokenResponse.status} ${safeError(tokenBody)}`);
  }

  const response = await request(`${sandboxUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tokenBody.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(patchOperations)
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`PAYPAL_API_FAILED ${response.status} ${safeError(body)}`);
  return { status: response.status };
}

function isPatchOperation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.path !== "string" || !value.path.startsWith("/")) {
    return false;
  }
  if (value.op === "remove") return true;
  return (value.op === "add" || value.op === "replace") && Object.hasOwn(value, "value");
}

function safeError(value) {
  if (!value || typeof value !== "object") return "unknown response";
  return String(value.name ?? value.error ?? value.message ?? "unknown response").slice(0, 160);
}
