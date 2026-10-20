# CartAttest

CartAttest checks whether an AI shopping agent's product choice matches the buyer's constraints before creating a PayPal order. The current codebase contains the core TypeScript services and persistence layer for governed checkout.

## Implemented

- Validated and hashed Claim Set storage.
- Deterministic checks for merchant, SKU, variant, quantity, currency and budget claims.
- Evidence completeness, freshness, source authority and semantic-attestation validation with process-local memoization.
- PayPal Orders v2 gateway, CartBinding checks before and after buyer approval, and a persisted checkout admission.
- Atomic capture attempts, GET-first reconciliation after uncertain capture responses, and verified, idempotent PayPal webhook handling.
- Server-side PayPal approval return and cancellation handlers that resolve order tokens through persisted admissions.
- Signed evidence-bundle creation and verification against an externally pinned key.
- A PayPal Sandbox HTTP server, buyer STEP-UP and verified receipt pages, automatic signed bundle finalization, CI tests and secret scanning.
- Dependency-injected API handlers and a versioned PostgreSQL schema.

## Current limits

Replay mode and a configured semantic-attestor provider are not complete. The Sandbox server fails closed on semantic claims until evaluation inputs are frozen and an attestor is configured. The fixture merchant is for development only. Receipt signing uses a local key generated with `pnpm keygen service-local-v1 .codex/keys/service`; production deployments must pin and manage their signing key outside the application bundle.

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

## Commands

```sh
pnpm typecheck
pnpm test
pnpm migrate
pnpm gate0 -- create path/to/cart-binding.json
pnpm gate0 -- get PAYPAL_ORDER_ID
pnpm gate0 -- capture PAYPAL_ORDER_ID PERSISTED_REQUEST_ID
pnpm gate0 -- patch PAYPAL_ORDER_ID path/to/patch.json
```

`pnpm migrate` applies the versioned checkout schema. Gate 0 uses PayPal Sandbox only. Review JSON Patch files before applying them because they mutate the named sandbox order. Record observations only after running the exact test against a sandbox account; the current Gate 0 summary remains unrun.

## Security boundary

Shopping-agent selection requests accept identifiers only. Price, terms, evidence, source authority, buyer decisions, PayPal order IDs and payment operations are resolved or controlled by the server. PayPal credentials and checkout operations stay server-side.
