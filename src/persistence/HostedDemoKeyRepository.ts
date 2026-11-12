import type { SqlPool } from "./CaptureAttemptRepository.js";

/**
 * Hosted demo keys. A hosted instance has no key files, so it creates one demo buyer key and one
 * service (receipt-signing) key on first start and keeps them in its own database, so receipts still
 * verify after a restart. Local runs keep using the key files in .codex/keys.
 */
export interface HostedDemoKeyPems {
  buyerPrivatePem: string;
  buyerPublicPem: string;
  servicePrivatePem: string;
  servicePublicPem: string;
}

export async function generateEs256Pems(): Promise<{ privatePem: string; publicPem: string }> {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const [pkcs8, spki] = await Promise.all([
    globalThis.crypto.subtle.exportKey("pkcs8", pair.privateKey),
    globalThis.crypto.subtle.exportKey("spki", pair.publicKey)
  ]);
  return { privatePem: pem("PRIVATE KEY", pkcs8), publicPem: pem("PUBLIC KEY", spki) };
}

export async function loadOrCreateHostedDemoKeys(pool: SqlPool, generate = generateEs256Pems): Promise<HostedDemoKeyPems> {
  const client = await pool.connect();
  try {
    const existing = await select(client);
    if (existing) return existing;
    const [buyer, service] = await Promise.all([generate(), generate()]);
    await client.query(
      `INSERT INTO hosted_demo_keys (key_set_id, buyer_private_pem, buyer_public_pem, service_private_pem, service_public_pem)
       VALUES ('default', $1, $2, $3, $4) ON CONFLICT (key_set_id) DO NOTHING`,
      [buyer.privatePem, buyer.publicPem, service.privatePem, service.publicPem]
    );
    const stored = await select(client);
    if (!stored) throw new Error("HOSTED_DEMO_KEYS_UNAVAILABLE");
    return stored;
  } finally {
    client.release();
  }
}

async function select(client: Awaited<ReturnType<SqlPool["connect"]>>): Promise<HostedDemoKeyPems | undefined> {
  const result = await client.query(
    `SELECT buyer_private_pem, buyer_public_pem, service_private_pem, service_public_pem
       FROM hosted_demo_keys WHERE key_set_id = 'default'`, []);
  const row = result.rows[0];
  if (!row) return undefined;
  const values = [row.buyer_private_pem, row.buyer_public_pem, row.service_private_pem, row.service_public_pem];
  if (values.some((value) => typeof value !== "string" || !value.includes("-----BEGIN "))) throw new Error("HOSTED_DEMO_KEYS_INVALID");
  return { buyerPrivatePem: values[0] as string, buyerPublicPem: values[1] as string,
    servicePrivatePem: values[2] as string, servicePublicPem: values[3] as string };
}

function pem(label: string, der: ArrayBuffer): string {
  const base64 = Buffer.from(der).toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}
