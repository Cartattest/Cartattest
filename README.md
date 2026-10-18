# CartAttest

CartAttest checks whether an AI shopping agent's product choice matches the buyer's constraints before creating a PayPal order. The current codebase contains the core TypeScript services and persistence layer for governed checkout.

## Implemented

- Validated and hashed Claim Set storage.
- Deterministic checks for merchant, SKU, variant, quantity, currency and budget claims.
- Evidence completeness, freshness, source authority and semantic-attestation validation with process-local memoization.
- PayPal Orders v2 gateway, CartBinding checks before and after buyer approval, and a persisted checkout admission.
- Atomic capture attempts, GET-first reconciliation after uncertain capture responses, and verified, idempotent PayPal webhook handling.
- Signed evidence-bundle creation and verification against an externally pinned key.
- Dependency-injected API handlers and a versioned PostgreSQL schema.

## Current limits

This is not yet a runnable web application. The repository does not include a server listener, buyer screens, a configured semantic-attestor provider, or a deployed database. STEP-UP outcomes currently identify the affected claim IDs; the trusted buyer decision flow is still to be built. The fixture merchant is for development only.

PayPal Sandbox characterization and end-to-end checkout have not been run. See [HOW_TO.md](HOW_TO.md) for owner setup and outstanding external inputs. Do not treat unit tests as evidence of a live PayPal or PostgreSQL flow.

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
