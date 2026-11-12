import type { SelectionAdmissionDependencies } from "../application/SelectionAdmissionEvaluator.js";
import { evaluateSelectionAdmission } from "../application/SelectionAdmissionEvaluator.js";
import { createOrderAfterAdmission } from "../application/SelectionCheckoutService.js";
import { completeCheckout } from "../application/CompleteCheckoutService.js";
import { handlePayPalWebhookRequest } from "./PayPalWebhookRoute.js";
import type { PayPalGateway } from "../ports/PayPalGateway.js";
import type { PayPalWebhookVerifier } from "../application/PayPalWebhookService.js";
import type { SqlPool } from "../persistence/CaptureAttemptRepository.js";
import { loadClaimSet, saveClaimSet } from "../persistence/ClaimSetRepository.js";
import { abortAwaitingAdmission, findAdmissionByPaypalOrderId, loadCheckoutStatus } from "../persistence/AdmissionRepository.js";
import { consumeStepUpSession, loadStepUpSession, saveStepUpSession } from "../persistence/StepUpSessionRepository.js";
import { parseBuyerOverrideV1 } from "./BuyerOverrideValidation.js";
import { parseClaimSetV1 } from "./ClaimSetValidation.js";
import { evaluateStepUpDecision, type StepUpContextV1 } from "../application/StepUpDecisionService.js";
import type { BuyerOverrideV1 } from "../domain/types.js";
import type { ClaimEvaluation } from "../policy/AdmissionPolicy.js";
import { answeredModel } from "../attestor/GeminiSemanticAttestor.js";
import canonicalize from "canonicalize";
import { finalizeEvidenceBundle, type EvidenceBundleSigningConfig } from "../application/FinalizeEvidenceBundle.js";
import { loadEvidenceBundle } from "../persistence/EvidenceBundleRepository.js";

const maxRequestBytes = 128_000;

export interface CheckoutApiDependencies {
  pool: SqlPool;
  gateway: PayPalGateway & PayPalWebhookVerifier;
  selection: Omit<SelectionAdmissionDependencies, "loadClaimSet">;
  webhookId: string;
  policyVersion: string;
  evidenceBundleSigning?: EvidenceBundleSigningConfig;
  replay?: { approveOrder(orderId: string): Promise<void> };
  buyerKeyId?: string;
  loadEvaluationReport?: () => Promise<unknown>;
}

export async function handleCheckoutApiRequest(request: Request, dependencies: CheckoutApiDependencies): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/claim-sets/prepare") {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return json({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
    }
    try {
      const claimSet = parseClaimSetV1(JSON.parse(await readBody(request)));
      const { buyerSignature: _signature, ...payload } = claimSet;
      const signingPayload = canonicalize(payload);
      if (signingPayload === undefined) return json({ error: "INVALID_CLAIM_SET" }, 400);
      return json({ claimSet: payload, signingPayload, buyerKeyId: dependencies.buyerKeyId ?? null }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "INVALID_CLAIM_SET";
      return json({ error: message === "REQUEST_BODY_TOO_LARGE" ? message : "INVALID_CLAIM_SET" }, message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400);
    }
  }
  if (path === "/checkout/return" || path === "/checkout/cancel") {
    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
    const tokens = url.searchParams.getAll("token");
    if (tokens.length !== 1 || !/^[A-Z0-9-]{1,64}$/.test(tokens[0]!)) {
      return json({ error: "INVALID_PAYPAL_ORDER_ID" }, 400);
    }
    try {
      const admission = await findAdmissionByPaypalOrderId(dependencies.pool, tokens[0]!);
      if (path === "/checkout/cancel") {
        if (admission.admissionState === "AWAITING_APPROVAL") {
          await abortAwaitingAdmission(dependencies.pool, admission.admissionId);
          return json({ status: "CANCELLED" }, 200);
        }
        return json(await loadCheckoutStatus(dependencies.pool, admission.admissionId), 200);
      }
      if (admission.admissionState === "CLOSED") {
        const bundle = await finalizeClosedAdmission(admission.admissionId, dependencies);
        if (bundle && acceptsHtmlNavigation(request)) return new Response(null, { status: 303, headers: { Location: `/receipt/${encodeURIComponent(bundle.bundleId)}` } });
        return json(await loadCheckoutStatus(dependencies.pool, admission.admissionId), 200);
      }
      const attempt = await completeCheckoutWithReplayReconciliation({ admissionId: admission.admissionId }, {
        pool: dependencies.pool, gateway: dependencies.gateway, newId: dependencies.selection.newId,
        ...(dependencies.selection.now ? { now: dependencies.selection.now } : {}),
        ...(dependencies.replay ? { replay: true } : {})
      });
      const bundle = isClosedCapture(attempt.state) ? await finalizeClosedAdmission(admission.admissionId, dependencies) : undefined;
      if (bundle && acceptsHtmlNavigation(request)) return new Response(null, { status: 303, headers: { Location: `/receipt/${encodeURIComponent(bundle.bundleId)}` } });
      return json({ state: attempt.state,
        ...(attempt.paypalCaptureId ? { captureId: attempt.paypalCaptureId } : {}),
        ...(attempt.paypalCaptureStatus ? { captureStatus: attempt.paypalCaptureStatus } : {}),
        ...(bundle ? { receiptUrl: `/receipt/${encodeURIComponent(bundle.bundleId)}` } : {}) }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CHECKOUT_FAILED";
      if (message === "INVALID_PAYPAL_ORDER_ID") return json({ error: message }, 400);
      if (message === "ADMISSION_NOT_FOUND") return json({ error: message }, 404);
      if (["ADMISSION_NOT_CAPTUREABLE", "PAYPAL_ORDER_NOT_APPROVED", "CART_BINDING_MISMATCH"].includes(message)) {
        return json({ error: message }, 409);
      }
      return json({ error: "CHECKOUT_FAILED" }, 500);
    }
  }
  if (path === "/api/webhooks/paypal") {
    if (!dependencies.webhookId) return json({ error: "PAYPAL_WEBHOOK_NOT_CONFIGURED" }, 503);
    return handlePayPalWebhookRequest(request, {
      webhookId: dependencies.webhookId, verifier: dependencies.gateway, pool: dependencies.pool,
      ...(dependencies.evidenceBundleSigning ? { onVerifiedEvent: async () => {
        // Retry closes whose earlier bundle write failed, including when PayPal retries a webhook.
        const client = await dependencies.pool.connect();
        let admissions: string[];
        try {
          const closed = await client.query(`SELECT a.admission_id AS "admissionId" FROM admissions a
            JOIN capture_attempts ca ON ca.admission_id = a.admission_id
            WHERE a.state = 'CLOSED' AND ca.state IN ('CLOSED_VERIFIED_WEBHOOK', 'CLOSED_RECONCILED')
              AND NOT EXISTS (SELECT 1 FROM evidence_bundles eb WHERE eb.bundle_id = a.admission_id)
            ORDER BY ca.updated_at`);
          admissions = closed.rows.map((row) => row.admissionId).filter((id): id is string => typeof id === "string");
        } finally { client.release(); }
        for (const admissionId of admissions) await finalizeEvidenceBundle(dependencies.pool, admissionId, dependencies.evidenceBundleSigning!);
      } } : {}),
      ...(dependencies.selection.now ? { now: dependencies.selection.now } : {})
    });
  }
  const replayApproval = /^\/api\/replay\/orders\/([^/]+)\/approve$/.exec(path);
  if (replayApproval) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
    if (!dependencies.replay) return json({ error: "REPLAY_MODE_DISABLED" }, 404);
    let orderId: string;
    try { orderId = decodeURIComponent(replayApproval[1]!); }
    catch { return json({ error: "INVALID_REPLAY_ORDER_ID" }, 400); }
    if (!/^REPLAY-ORDER-[A-Za-z0-9_-]{1,64}-[1-9][0-9]*$/.test(orderId)) return json({ error: "INVALID_REPLAY_ORDER_ID" }, 400);
    try {
      await dependencies.replay.approveOrder(orderId);
      return json({ approved: true }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "REPLAY_APPROVAL_FAILED";
      if (message === "PAYPAL_ORDER_NOT_FOUND") return json({ error: message }, 404);
      if (message === "PAYPAL_ORDER_NOT_APPROVABLE") return json({ error: message }, 409);
      return json({ error: "REPLAY_APPROVAL_FAILED" }, 500);
    }
  }
  const receiptMatch = /^\/api\/receipts\/([^/]+)$/.exec(path);
  if (receiptMatch) {
    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
    if (!dependencies.evidenceBundleSigning) return json({ error: "RECEIPTS_NOT_CONFIGURED" }, 503);
    let bundleId: string;
    try { bundleId = decodeURIComponent(receiptMatch[1]!); }
    catch { return json({ error: "INVALID_BUNDLE_ID" }, 400); }
    try {
      const bundle = await loadEvidenceBundle(dependencies.pool, bundleId, dependencies.evidenceBundleSigning.trustedKeys);
      return json(receiptProjection(bundle), 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "RECEIPT_UNAVAILABLE";
      if (message === "INVALID_BUNDLE_ID") return json({ error: message }, 400);
      if (message === "EVIDENCE_BUNDLE_NOT_FOUND") return json({ error: message }, 404);
      return json({ error: "RECEIPT_VERIFICATION_FAILED" }, 503);
    }
  }
  const statusMatch = /^\/api\/checkouts\/([^/]+)$/.exec(path);
  if (statusMatch) {
    if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET" });
    let admissionId: string;
    try { admissionId = decodeURIComponent(statusMatch[1]!); }
    catch { return json({ error: "INVALID_ADMISSION_ID" }, 400); }
    try { return json(await loadCheckoutStatus(dependencies.pool, admissionId), 200); }
    catch (error) {
      const message = error instanceof Error ? error.message : "CHECKOUT_FAILED";
      if (message === "INVALID_ADMISSION_ID") return json({ error: message }, 400);
      if (message === "ADMISSION_NOT_FOUND") return json({ error: message }, 404);
      return json({ error: "CHECKOUT_FAILED" }, 500);
    }
  }
  const stepUpMatch = /^\/api\/step-ups\/([^/]+)$/.exec(path);
  if (stepUpMatch) {
    let sessionId: string;
    try { sessionId = decodeURIComponent(stepUpMatch[1]!); }
    catch { return json({ error: "INVALID_STEP_UP_SESSION" }, 400); }
    return handleStepUpRequest(request, sessionId, dependencies);
  }
  const methods: Record<string, string> = {
    "/api/claim-sets": "POST", "/api/selections": "POST", "/api/checkout/complete": "POST"
  };
  const expectedMethod = methods[path];
  if (!expectedMethod) return json({ error: "NOT_FOUND" }, 404);
  if (request.method !== expectedMethod) return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: expectedMethod });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  let body: unknown;
  try { body = JSON.parse(await readBody(request)); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ error: code === "REQUEST_BODY_TOO_LARGE" ? code : "INVALID_JSON" }, code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400);
  }

  try {
    if (path === "/api/claim-sets") {
      const claimSet = parseClaimSetV1(body);
      let signatureValid = false;
      try { signatureValid = Boolean(claimSet.buyerSignature) && await dependencies.selection.verifyBuyerSignature(claimSet); }
      catch { signatureValid = false; }
      if (!signatureValid) return json({ error: "INVALID_CLAIM_SET_SIGNATURE" }, 400);
      const claimSetHash = await saveClaimSet(dependencies.pool, claimSet);
      return json({ status: "STORED", claimSetId: claimSet.claimSetId, claimSetHash }, 201);
    }
    if (path === "/api/selections") {
      const evaluation = await evaluateSelectionAdmission(body, {
        ...dependencies.selection,
        loadClaimSet: (claimSetId) => loadClaimSet(dependencies.pool, claimSetId)
      });
      const checks = "claimEvaluations" in evaluation ? evidenceChecks(evaluation.claimEvaluations) : [];
      if (evaluation.outcome.status === "BLOCK") {
        return json({ status: "BLOCKED", reason: evaluation.outcome.reason, ...(checks.length ? { evidenceChecks: checks } : {}) }, 200);
      }
      if (evaluation.outcome.status === "STEP_UP") {
        if (!("claimSet" in evaluation)) throw new Error("INVALID_STEP_UP_CONTEXT");
        const createdAt = dependencies.selection.now?.() ?? new Date();
        if (!Number.isFinite(createdAt.getTime())) throw new Error("INVALID_POLICY_TIME");
        const expiresAt = new Date(Math.min(createdAt.getTime() + 10 * 60_000, Date.parse(evaluation.claimSet.expiresAt))).toISOString();
        const sessionId = dependencies.selection.newId();
        const context: StepUpContextV1 = {
          schemaVersion: "step-up-context-v1",
          claimIds: evaluation.outcome.claimIds,
          expiresAt,
          claimSet: evaluation.claimSet,
          claimSetHash: evaluation.claimSetHash,
          resolvedSelection: evaluation.resolvedSelection,
          claimEvaluations: evaluation.claimEvaluations,
          admissionEvidence: evaluation.admissionEvidence
        };
        await saveStepUpSession(dependencies.pool, {
          sessionId,
          context: context as unknown as Record<string, unknown>,
          createdAt: createdAt.toISOString(),
          expiresAt
        });
        return json({ status: "STEP_UP", decisionUrl: `/step-up/${encodeURIComponent(sessionId)}`, ...(checks.length ? { evidenceChecks: checks } : {}) }, 200);
      }
      const checkout = await createOrderAfterAdmission(evaluation, {
        pool: dependencies.pool, gateway: dependencies.gateway, newId: dependencies.selection.newId,
        policyVersion: dependencies.policyVersion,
        ...(dependencies.selection.now ? { now: dependencies.selection.now } : {})
      });
      if (!("admissionId" in checkout)) throw new Error("INVALID_ADMISSION_EVALUATION");
      return json({ status: "ALLOWED", admissionId: checkout.admissionId, approvalUrl: checkout.approvalUrl, ...(checks.length ? { evidenceChecks: checks } : {}) }, 200);
    }
    const result = await completeCheckoutWithReplayReconciliation(body, {
      pool: dependencies.pool, gateway: dependencies.gateway, newId: dependencies.selection.newId,
      ...(dependencies.selection.now ? { now: dependencies.selection.now } : {}),
      ...(dependencies.replay ? { replay: true } : {})
    });
    const bundle = isClosedCapture(result.state) ? await finalizeClosedAdmission(String((body as { admissionId?: unknown }).admissionId), dependencies) : undefined;
    return json({ state: result.state, ...(result.paypalCaptureId ? { captureId: result.paypalCaptureId } : {}),
      ...(result.paypalCaptureStatus ? { captureStatus: result.paypalCaptureStatus } : {}),
      ...(bundle ? { receiptUrl: `/receipt/${encodeURIComponent(bundle.bundleId)}` } : {}) }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CHECKOUT_FAILED";
    if (message === "CLAIM_SET_ID_CONFLICT") return json({ error: message }, 409);
    if (message.startsWith("INVALID_")) return json({ error: message }, 400);
    if (["CLAIM_SET_NOT_FOUND", "ADMISSION_NOT_CAPTUREABLE", "CAPTURE_ATTEMPT_NOT_FOUND"].includes(message)) {
      return json({ error: message }, 404);
    }
    if (["CART_BINDING_MISMATCH", "PAYPAL_ORDER_NOT_APPROVED", "ATTESTATION_BINDING_MISMATCH"].includes(message)) {
      return json({ error: message }, 409);
    }
    return json({ error: "CHECKOUT_FAILED" }, 500);
  }
}

async function handleStepUpRequest(
  request: Request,
  sessionId: string,
  dependencies: CheckoutApiDependencies
): Promise<Response> {
  const now = dependencies.selection.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) return json({ error: "INVALID_POLICY_TIME" }, 400);
  let context: StepUpContextV1;
  try {
    const stored = await loadStepUpSession(dependencies.pool, sessionId, now.toISOString());
    if (!isStepUpContext(stored)) return json({ error: "STEP_UP_CONTEXT_INVALID" }, 500);
    context = stored;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "INVALID_STEP_UP_SESSION") return json({ error: code }, 400);
    if (code === "STEP_UP_SESSION_UNAVAILABLE") return json({ error: code }, 404);
    return json({ error: "STEP_UP_SESSION_FAILED" }, 500);
  }

  if (request.method === "GET") return json(stepUpView(context, dependencies.selection.newId), 200);
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST" });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return json({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }

  let body: unknown;
  try { body = JSON.parse(await readBody(request)); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    return json({ error: code === "REQUEST_BODY_TOO_LARGE" ? code : "INVALID_JSON" }, code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400);
  }
  if (!isRecord(body) || typeof body.decision !== "string") return json({ error: "INVALID_STEP_UP_DECISION" }, 400);
  if (body.decision === "CHOOSE_ANOTHER") {
    if (Object.keys(body).length !== 1) return json({ error: "INVALID_STEP_UP_DECISION" }, 400);
    try {
      await consumeStepUpSession(dependencies.pool, sessionId, now.toISOString());
      return json({ status: "CHOOSE_ANOTHER" }, 200);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "STEP_UP_SESSION_UNAVAILABLE" }, 409);
    }
  }
  if (body.decision !== "ACCEPT_EXACT_EXCEPTION" || Object.keys(body).length !== 2 || !Array.isArray(body.overrides) ||
      body.overrides.length === 0 || body.overrides.length > context.claimIds.length) {
    return json({ error: "INVALID_STEP_UP_DECISION" }, 400);
  }

  let overrides: BuyerOverrideV1[];
  try { overrides = body.overrides.map(parseBuyerOverrideV1); }
  catch { return json({ error: "INVALID_BUYER_OVERRIDE" }, 400); }
  // Signature verification is async; the policy is synchronous. Verify first, then hand the policy the results.
  // Comparing the unresolved Promise with `=== true` rejected every genuine override (F4).
  const verifiedOverrides = new Set<BuyerOverrideV1>();
  if (dependencies.selection.verifyOverride) {
    for (const override of overrides) {
      try { if (await dependencies.selection.verifyOverride(override) === true) verifiedOverrides.add(override); }
      catch { /* An unverifiable override stays unverified and the policy blocks it. */ }
    }
  }
  const result = await evaluateStepUpDecision(context, overrides, {
    now: now.toISOString(),
    ...(dependencies.selection.verifyOverride ? { verifyOverride: (override: BuyerOverrideV1) => verifiedOverrides.has(override) } : {})
  });
  if (result.outcome.status === "BLOCK") return json({ status: "BLOCKED", reason: result.outcome.reason }, 409);
  if (result.outcome.status === "STEP_UP") return json({ status: "STEP_UP", claimIds: result.outcome.claimIds }, 200);

  try { await consumeStepUpSession(dependencies.pool, sessionId, now.toISOString()); }
  catch { return json({ error: "STEP_UP_SESSION_UNAVAILABLE" }, 409); }

  try {
    const checkout = await createOrderAfterAdmission(result, {
      pool: dependencies.pool,
      gateway: dependencies.gateway,
      newId: dependencies.selection.newId,
      policyVersion: dependencies.policyVersion,
      ...(dependencies.selection.now ? { now: dependencies.selection.now } : {})
    });
    if (!("admissionId" in checkout)) throw new Error("INVALID_ADMISSION_EVALUATION");
    return json({ status: "ALLOWED", admissionId: checkout.admissionId, approvalUrl: checkout.approvalUrl }, 200);
  } catch {
    return json({ error: "CHECKOUT_FAILED" }, 500);
  }
}

function stepUpView(context: StepUpContextV1, newId: () => string): unknown {
  const item = context.resolvedSelection.cartBinding.items[0];
  return {
    expiresAt: context.expiresAt,
    buyerKeyId: context.claimSet.buyerSignature?.keyId,
    subject: {
      subjectRef: context.resolvedSelection.subjectRef,
      ...(item ? { name: item.name, sku: item.sku } : {}),
      ...(context.resolvedSelection.cartBinding.amountBreakdown?.total
        ? { total: context.resolvedSelection.cartBinding.amountBreakdown.total, currency: context.resolvedSelection.cartBinding.currency }
        : {})
    },
    claims: context.claimIds.map((claimId) => {
      const evaluation = context.claimEvaluations.find((candidate) => candidate.claim.claimId === claimId)!;
      const exceptionAllowed = evaluation.claim.overridePolicy === "HUMAN_EXACT_SUBJECT" && Boolean(evaluation.attestationHash);
      const overridePayload = exceptionAllowed && context.claimSet.buyerSignature ? {
        schemaVersion: "buyer-override-v1",
        overrideId: newId(),
        claimSetHash: evaluation.claimSetHash,
        claimId,
        subjectRef: context.resolvedSelection.subjectRef,
        subjectHash: evaluation.subjectHash,
        evidenceSetHash: evaluation.evidenceSetHash,
        attestationHash: evaluation.attestationHash!,
        decision: "ACCEPT_EXCEPTION",
        expiresAt: context.expiresAt,
        nonce: newId()
      } : undefined;
      const signingPayload = overridePayload ? canonicalize(overridePayload) : undefined;
      return {
        claimId,
        text: evaluation.claim.humanText,
        value: evaluation.claim.value,
        exceptionAllowed: exceptionAllowed && Boolean(signingPayload),
        ...(signingPayload ? { overrideSigningPayload: signingPayload, buyerKeyId: context.claimSet.buyerSignature!.keyId } : {}),
        claimSetHash: evaluation.claimSetHash,
        subjectHash: evaluation.subjectHash,
        evidenceSetHash: evaluation.evidenceSetHash,
        ...(evaluation.attestationHash ? { attestationHash: evaluation.attestationHash } : {}),
        ...(evaluation.attestation ? { evidenceCheck: evidenceChecks([evaluation])[0] } : {}),
        evidence: (evaluation.evidence ?? []).map((record) => ({
          sourceClass: record.sourceClass,
          origin: record.origin,
          fieldLocator: record.fieldLocator,
          retrievedAt: record.retrievedAt,
          text: record.modelView
        }))
      };
    })
  };
}

function isStepUpContext(value: unknown): value is StepUpContextV1 {
  if (!isRecord(value) || value.schemaVersion !== "step-up-context-v1" || !Array.isArray(value.claimIds) ||
      !value.claimIds.every((claimId) => typeof claimId === "string") || !Number.isFinite(Date.parse(String(value.expiresAt))) ||
      !isRecord(value.claimSet) || typeof value.claimSetHash !== "string" || !isRecord(value.resolvedSelection) ||
      !isRecord(value.admissionEvidence) || !Array.isArray(value.claimEvaluations)) return false;
  const resolved = value.resolvedSelection;
  if (typeof resolved.subjectRef !== "string" || !isRecord(resolved.cartBinding) || !Array.isArray(resolved.cartBinding.items)) return false;
  const evaluations = value.claimEvaluations;
  return value.claimIds.every((claimId) => evaluations.some((evaluation) => isRecord(evaluation) &&
    isRecord(evaluation.claim) && evaluation.claim.claimId === claimId && typeof evaluation.claim.humanText === "string"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function finalizeClosedAdmission(admissionId: string, dependencies: CheckoutApiDependencies) {
  return dependencies.evidenceBundleSigning
    ? finalizeEvidenceBundle(dependencies.pool, admissionId, dependencies.evidenceBundleSigning)
    : undefined;
}

async function completeCheckoutWithReplayReconciliation(
  input: unknown,
  dependencies: Parameters<typeof completeCheckout>[1] & { replay?: boolean }
) {
  const { replay, ...checkoutDependencies } = dependencies;
  let result = await completeCheckout(input, checkoutDependencies);
  if (replay && result.state === "CAPTURE_COMPLETED_PENDING_WEBHOOK") {
    // Replay has no external webhook delivery, so exercise the same GET-first close path deterministically.
    result = await completeCheckout(input, checkoutDependencies);
  }
  return result;
}

function isClosedCapture(state: string): state is "CLOSED_VERIFIED_WEBHOOK" | "CLOSED_RECONCILED" {
  return state === "CLOSED_VERIFIED_WEBHOOK" || state === "CLOSED_RECONCILED";
}

function acceptsHtmlNavigation(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function receiptProjection(bundle: import("../bundle/EvidenceBundle.js").EvidenceBundleV1): unknown {
  const payload = (type: string) => bundle.records.find((record) => record.recordType === type)?.payload;
  const selection = payload("ResolvedSelection");
  const claimSet = payload("BuyerClaimSet");
  const admission = payload("AdmissionRecord");
  const capture = payload("CaptureAttempt");
  if (!isRecord(selection) || !isRecord(selection.cartBinding) || !Array.isArray(selection.cartBinding.items) ||
      !isRecord(claimSet) || !Array.isArray(claimSet.claims) || !isRecord(admission) || !isRecord(capture)) {
    throw new Error("INVALID_RECEIPT_CONTENT");
  }
  const binding = selection.cartBinding;
  const item = (binding.items as unknown[])[0];
  const claims = claimSet.claims.filter(isRecord).map((claim) => {
    const attestation = bundle.records.find((record) => record.recordType === "SemanticAttestation" &&
      isRecord(record.payload) && record.payload.claimId === claim.claimId)?.payload;
    const evidenceHashes = isRecord(attestation) && Array.isArray(attestation.evidenceHashes) ? attestation.evidenceHashes : [];
    return {
      text: typeof claim.humanText === "string" ? claim.humanText : "",
      evidence: bundle.records.filter((record) => record.recordType === "MerchantEvidence" && isRecord(record.payload) &&
        evidenceHashes.includes(record.payload.rawHash))
        .map((record) => isRecord(record.payload) ? {
          sourceClass: record.payload.sourceClass, locator: record.payload.fieldLocator,
          text: record.payload.modelView
        } : undefined).filter(Boolean)
    };
  });
  return {
    verified: true,
    sealedAt: bundle.seal.sealedAt,
    closureState: bundle.seal.closureState,
    item: isRecord(item) ? { name: item.name, sku: item.sku, quantity: item.quantity } : {},
    amount: isRecord(binding.amountBreakdown) ? { total: binding.amountBreakdown.total, currency: binding.currency } : {},
    claims,
    admission: { outcome: admission.outcome, policyVersion: admission.policyVersion },
    capture: { state: capture.state, status: capture.paypalCaptureStatus, captureId: capture.paypalCaptureId },
    bundleId: bundle.bundleId
  };
}

async function readBody(request: Request): Promise<string> {
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxRequestBytes) {
        await reader.cancel();
        throw new Error("REQUEST_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function json(value: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders } });
}

/** What the semantic attestor reported, for display only. Admission was already decided by deterministic policy. */
function evidenceChecks(evaluations: ClaimEvaluation[]) {
  return evaluations.flatMap((evaluation) => {
    const attestation = evaluation.attestation;
    if (!attestation) return [];
    const quote = (value: { evidenceId: string; verbatim: string }) => ({
      sourceClass: evaluation.evidence?.find((item) => item.evidenceId === value.evidenceId)?.sourceClass ?? "UNKNOWN",
      verbatim: value.verbatim
    });
    return [{
      claimId: evaluation.claim.claimId,
      result: attestation.result,
      modelId: answeredModel(attestation.attestationId) ?? attestation.modelId,
      supportQuotes: attestation.supportQuotes.map(quote),
      contradictionQuotes: attestation.contradictionQuotes.map(quote)
    }];
  });
}
