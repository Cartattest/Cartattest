import { readFile } from "node:fs/promises";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { FixtureMerchantAdapter } from "../dist/merchant/FixtureMerchantAdapter.js";
import { OrdersV2Gateway } from "../dist/paypal/OrdersV2Gateway.js";
import { ReplayPayPalGateway } from "../dist/paypal/ReplayPayPalGateway.js";
import { createPostgresSqlPool } from "../dist/persistence/PostgresSqlPool.js";
import { verifyBuyerOverrideSignature, verifyClaimSetSignature } from "../dist/security/BuyerSignatures.js";
import { sha256 } from "../dist/domain/Hash.js";
import { hashEvidenceSet } from "../dist/bundle/EvidenceSet.js";
import { createCheckoutHttpServer } from "../dist/server/CheckoutHttpServer.js";

const demoMode = process.env.DEMO_MODE || "sandbox";
if (!["sandbox", "replay"].includes(demoMode)) throw new Error("DEMO_MODE_INVALID");
const required = ["DATABASE_URL", "CARTATTEST_BUYER_KEY_ID", "CARTATTEST_BUYER_PUBLIC_KEY_PATH"];
if (demoMode === "sandbox") required.push("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_RETURN_URL", "PAYPAL_CANCEL_URL");
for (const name of required) if (!process.env[name]) throw new Error(name + "_REQUIRED");
if ((process.env.PAYPAL_ENV || "sandbox") === "live") throw new Error("SANDBOX_SERVER_ONLY");
let payee = process.env.PAYPAL_MERCHANT_ID
  ? { identityType: "MERCHANT_ID", identityValue: process.env.PAYPAL_MERCHANT_ID }
  : process.env.PAYPAL_MERCHANT_EMAIL
    ? { identityType: "EMAIL", identityValue: process.env.PAYPAL_MERCHANT_EMAIL }
    : undefined;

const keyPem = await readFile(process.env.CARTATTEST_BUYER_PUBLIC_KEY_PATH, "utf8");
const keyDer = createPublicKey(keyPem).export({ type: "spki", format: "der" });
const buyerKey = await crypto.subtle.importKey("spki", keyDer, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const buyerKeys = new Map([[process.env.CARTATTEST_BUYER_KEY_ID, buyerKey]]);
const servicePrivatePath = process.env.CARTATTEST_SERVICE_PRIVATE_KEY_PATH || ".codex/keys/service.private.pem";
const servicePublicPath = process.env.CARTATTEST_SERVICE_PUBLIC_KEY_PATH || ".codex/keys/service.public.pem";
let evidenceBundleSigning;
if (servicePrivatePath && servicePublicPath) {
  const [privatePem, publicPem] = await Promise.all([readFile(servicePrivatePath, "utf8"), readFile(servicePublicPath, "utf8")]);
  const privateDer = createPrivateKey(privatePem).export({ type: "pkcs8", format: "der" });
  const publicDer = createPublicKey(publicPem).export({ type: "spki", format: "der" });
  const derivedPublicDer = createPublicKey(createPrivateKey(privatePem)).export({ type: "spki", format: "der" });
  if (!derivedPublicDer.equals(publicDer)) throw new Error("CARTATTEST_SERVICE_KEY_PAIR_MISMATCH");
  const privateKey = await crypto.subtle.importKey("pkcs8", privateDer, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const publicKey = await crypto.subtle.importKey("spki", publicDer, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const keyId = process.env.CARTATTEST_SERVICE_KEY_ID || "service-local-v1";
  evidenceBundleSigning = { keyId, privateKey, trustedKeys: new Map([[keyId, publicKey]]) };
}

const [catalogue, manifestFile] = await Promise.all([
  readJson(new URL("../fixtures/merchant/catalogue.json", import.meta.url)),
  readJson(new URL("../fixtures/merchant/evidence-manifests.json", import.meta.url))
]);
if (!payee && demoMode === "replay") payee = catalogue.merchant.payee;
if (!payee) throw new Error("PAYPAL_MERCHANT_ID_OR_EMAIL_REQUIRED");
catalogue.merchant.payee = payee;
const merchant = new FixtureMerchantAdapter(catalogue);
const manifests = new Map(manifestFile.profiles.map((value) => {
  const profile = {
    schemaVersion: value.schema_version,
    evidenceProfileId: value.evidence_profile_id,
    requiredSourceClasses: value.required_source_classes,
    admissibleSourceClasses: value.admissible_source_classes,
    sourceAuthority: value.source_authority.map((rule) => ({
      sourceClass: rule.source_class, rank: rule.rank, maySatisfy: rule.may_satisfy,
      mayBlockIfContradictory: rule.may_block_if_contradictory
    })),
    freshnessSeconds: value.freshness_seconds,
    contradictionPolicy: value.contradiction_policy
  };
  return [profile.evidenceProfileId, profile];
}));

const disabledHash = await sha256("cartattest-disabled-attestor-v1");
const pool = createPostgresSqlPool(process.env.DATABASE_URL);
const replayObservation = demoMode === "replay"
  ? await readJson(new URL("../fixtures/paypal/sanitized/g0-01-approved-capture.json", import.meta.url))
  : undefined;
if (replayObservation && (replayObservation.observations?.approvalRequired !== true ||
    replayObservation.observations?.approvedOrderStatus !== "APPROVED" || replayObservation.observations?.captureStatus !== "COMPLETED")) {
  throw new Error("REPLAY_FIXTURE_INVALID");
}
const replayGateway = replayObservation ? new ReplayPayPalGateway({
  approvalRequired: replayObservation.observations.approvalRequired,
  approvedOrderStatus: replayObservation.observations.approvedOrderStatus,
  captureStatus: replayObservation.observations.captureStatus
}) : undefined;
const gateway = replayGateway
  ? Object.assign(replayGateway, { verifyWebhookSignature: async () => false })
  : new OrdersV2Gateway({
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    environment: "sandbox",
    returnUrl: process.env.PAYPAL_RETURN_URL,
    cancelUrl: process.env.PAYPAL_CANCEL_URL
  });
const server = createCheckoutHttpServer({
  pool,
  gateway,
  webhookId: replayGateway ? "" : process.env.PAYPAL_WEBHOOK_ID,
  policyVersion: "policy-v1",
  ...(replayGateway ? { replay: replayGateway } : {}),
  ...(evidenceBundleSigning ? { evidenceBundleSigning } : {}),
  selection: {
    verifyBuyerSignature: (claimSet) => verifyClaimSetSignature(claimSet, buyerKeys),
    verifyOverride: (override) => verifyBuyerOverrideSignature(override, buyerKeys),
    merchant,
    getManifest(profileId) {
      const manifest = manifests.get(profileId);
      if (!manifest) throw new Error("INVALID_EVIDENCE_PROFILE");
      return manifest;
    },
    getAttestorConfig() {
      return {
        provider: "disabled", modelId: "disabled", temperature: 0, topP: 1, maxOutputTokens: 1,
        promptHash: disabledHash, configHash: disabledHash, attestorVersion: "fail-closed-v1"
      };
    },
    attestor: {
      async attest(args) {
        return {
          schemaVersion: "semantic-attestation-v1",
          attestationId: crypto.randomUUID(),
          claimId: args.claim.claimId,
          subjectHash: args.subjectHash,
          evidenceSetHash: await hashEvidenceSet(args.evidence),
          evidenceHashes: args.evidence.map((item) => item.rawHash),
          result: "UNPROVEN",
          supportQuotes: [],
          contradictionQuotes: [],
          modelId: "disabled",
          attestorVersion: "fail-closed-v1",
          promptHash: disabledHash,
          configHash: disabledHash,
          createdAt: new Date().toISOString()
        };
      }
    },
    newId: () => crypto.randomUUID()
  }
});
const port = Number(process.env.PORT || "3000");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT_INVALID");
server.listen(port, "127.0.0.1", () => process.stdout.write("CartAttest Sandbox listening on http://127.0.0.1:" + port + "\n"));

server.on("close", () => pool.end().catch(() => {}));
process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
