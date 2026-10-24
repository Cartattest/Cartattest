import { readFile } from "node:fs/promises";
import { createPublicKey } from "node:crypto";
import { verifyEvidenceBundle } from "../dist/bundle/EvidenceBundle.js";

const [bundlePath, keyId, publicKeyPath, ...extra] = process.argv.slice(2);
if (!bundlePath || !keyId || !publicKeyPath || extra.length) {
  throw new Error("USAGE: pnpm verify:bundle <bundle.json> <pinned-key-id> <public-key.pem>");
}

try {
  const [bundleJson, pem] = await Promise.all([
    readFile(bundlePath, "utf8"),
    readFile(publicKeyPath, "utf8")
  ]);
  const bundle = JSON.parse(bundleJson);
  const publicKeyDer = createPublicKey(pem).export({ type: "spki", format: "der" });
  const publicKey = await crypto.subtle.importKey("spki", publicKeyDer, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  await verifyEvidenceBundle(bundle, new Map([[keyId, publicKey]]));
  process.stdout.write(`VERIFIED bundle=${bundle.bundleId} records=${bundle.records.length} key=${keyId}\n`);
} catch (error) {
  const reason = error instanceof Error ? error.message : "INVALID_EVIDENCE_BUNDLE";
  process.stderr.write(`INVALID ${reason}\n`);
  process.exitCode = 1;
}
