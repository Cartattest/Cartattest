# CartAttest

CartAttest checks whether an AI shopping agent's product choice matches the buyer's constraints before creating a PayPal order. The current codebase contains the core TypeScript services and persistence layer for governed checkout.

## Implemented

- Validated and hashed Claim Set storage.
- Deterministic checks for merchant, SKU, variant, quantity, currency and budget claims.
- Evidence completeness, freshness, source authority and semantic-attestation validation with process-local memoization.
- PayPal Orders v2 gateway, CartBinding checks before and after buyer approval, and a persisted checkout admission.
- Atomic capture attempts, GET-first reconciliation after uncertain capture responses, and verified, idempotent PayPal webhook handling.
- Server-side PayPal approval return and cancellation handlers that resolve order tokens through persisted admissions.
- Buyer Claim Set review and browser-side ES256 signing; the API verifies signatures before storing claims.
- Signed evidence-bundle creation and verification against an externally pinned key.
- A PayPal Sandbox or deterministic replay server, buyer STEP-UP and verified receipt pages, automatic signed bundle finalization, CI tests and secret scanning.
- Dependency-injected API handlers and a versioned PostgreSQL schema.

## Current limits

Replay mode is local and synthetic: it reuses the recorded G0-01 approval/capture status, but does not contact PayPal or move money. A configured semantic-attestor provider is not complete. The server fails closed on semantic claims until evaluation inputs are frozen and an attestor is configured. The fixture merchant is for development only. Receipt signing uses a local key generated with `pnpm keygen service-local-v1 .codex/keys/service`; production deployments must pin and manage their signing key outside the application bundle.

Gate 0 is still in progress: a Sandbox order was approved and captured, but the material create-vs-approval projection and remaining mutation/webhook observations are incomplete. See [fixtures/paypal/gate0-summary.md](fixtures/paypal/gate0-summary.md) and [HOW_TO.md](HOW_TO.md). Unit tests do not replace live PostgreSQL or end-to-end checkout verification.

## Requirements

- Node.js 22
- pnpm 10.29.3
- PostgreSQL for repository and migration use
- PayPal Sandbox credentials for Gate 0 and live checkout characterization

## Setup

```sh
corepack enable
pnpm install
cp .env.example .env
```

Set `DATABASE_URL` before running migrations. Keep `.env` local and never commit credentials.

For a fresh checkout, generate the local buyer and receipt-signing key pairs before starting the server or running `pnpm replay:e2e`:

```sh
pnpm keygen buyer-local-v1 .codex/keys/buyer
pnpm keygen service-local-v1 .codex/keys/service
```

These local keys live under ignored `.codex/`; the command refuses to overwrite existing key files.

## Commands

```sh
pnpm typecheck
pnpm test
pnpm migrate
DEMO_MODE=sandbox pnpm start
DEMO_MODE=replay pnpm start
# Then visit http://127.0.0.1:3000/evaluation for the evaluation view.
pnpm replay:e2e             # while replay server is running
pnpm gate0 -- create path/to/cart-binding.json
pnpm gate0 -- get PAYPAL_ORDER_ID
pnpm gate0 -- capture PAYPAL_ORDER_ID PERSISTED_REQUEST_ID
pnpm gate0 -- patch PAYPAL_ORDER_ID path/to/patch.json
pnpm eval:report -- fixtures/evaluation/dev-scenarios.jsonl fixtures/evaluation/dev-inputs.jsonl .codex/evaluation/dev-runs.jsonl .codex/evaluation/dev-report.json
```

`pnpm migrate` applies the versioned checkout schema. Set `DEMO_MODE=replay` in `.env` for a local deterministic checkout with a labeled simulated approval; it does not contact PayPal or move money. Set `DEMO_MODE=sandbox` for real Sandbox checkout. Review patch files before applying because they mutate the named sandbox order. Record observations only after running the exact test against a sandbox account; Gate 0 remains in progress.

## Security boundary

Shopping-agent selection requests accept identifiers only. Price, terms, evidence, source authority, buyer decisions, PayPal order IDs and payment operations are resolved or controlled by the server. PayPal credentials and checkout operations stay server-side.

## Threat model and limits

The prototype assumes the shopping agent may misread product evidence or propose a selection that violates the buyer's Claim Set. CartAttest independently resolves the selected item and merchant evidence, applies source-authority policy, then binds the admitted cart to the PayPal order before capture. It does not prove that merchant statements are true, protect against a malicious merchant or operator controlling the evidence source, or provide an atomic PayPal compare-and-swap between the final order read and capture. The buyer decision page also assumes the shopping agent cannot automate that trusted origin.

## Prior art and contribution

PayPal approval and request idempotency govern payment authorization and duplicate requests. Signed receipts and generic admission gates can record or gate a transaction. CartAttest's prototype contribution is to evaluate source-typed merchant evidence against buyer-approved semantic constraints before order creation, then bind that admitted commerce object through execution. The evaluation should be read as a test of this composition, not a claim that any single component is new.

## Questions this prototype does not settle

- It cannot establish that a merchant's product claim is physically true; it can only show which supplied source supports or contradicts it.
- It does not replace the buyer's PayPal approval or guarantee PayPal will reject every order mutation.
- Its merchant catalogue is a development fixture, not a production connector or independent provenance authority.
- Its hidden holdout and exact model configuration are still owner-controlled release prerequisites.

## Development evaluation

`fixtures/evaluation/` contains 20 synthetic matched pairs (40 cases) across the eight defined attack families. The report command checks pair and template coverage, validates one saved input per case, and scores supplied A/B/C and fail-closed reference run records. It reports unsafe ALLOWs, unnecessary STEP-UPs, instability, errors, and latency percentiles. Raw traces from the private run file are not copied into the report. The script scores runs; it does not call a model or create an evaluation lock. Do not use it for the owner-held holdout.

After a report is generated at `.codex/evaluation/dev-report.json`, the local server serves the compact results view at `/evaluation`. The API exposes only the aggregate development metrics needed by that page.
