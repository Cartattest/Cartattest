import { generateKeyPairSync } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [keyId, prefix, ...extra] = process.argv.slice(2);
if (!keyId || !prefix || extra.length || !/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
  throw new Error("USAGE: pnpm keygen <key-id> <output-prefix>");
}

const privatePath = resolve(prefix + ".private.pem");
const publicPath = resolve(prefix + ".public.pem");
for (const path of [privatePath, publicPath]) {
  try {
    await access(path);
    throw new Error("KEY_FILE_ALREADY_EXISTS");
  } catch (error) {
    if (error instanceof Error && error.message === "KEY_FILE_ALREADY_EXISTS") throw error;
  }
}
await mkdir(dirname(privatePath), { recursive: true, mode: 0o700 });
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});
let privateKeyCreated = false;
try {
  await writeFile(privatePath, privateKey, { mode: 0o600, flag: "wx" });
  privateKeyCreated = true;
  await writeFile(publicPath, publicKey, { mode: 0o644, flag: "wx" });
} catch (error) {
  if (privateKeyCreated) await rm(privatePath, { force: true });
  throw error;
}
process.stdout.write("Created key " + keyId + "\nPrivate: " + privatePath + "\nPublic:  " + publicPath + "\n");
