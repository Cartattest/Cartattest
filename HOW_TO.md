# Owner setup guide

This guide separates implemented configuration from the external services and owner decisions still needed for a live demo.

## Local setup

```sh
corepack enable
pnpm install
cp .env.example .env
```

Keep secrets in `.env`; it is gitignored. Never paste credentials into source, chat, issues, or public fixtures.

## Configuration

| Variable | Purpose | Current state |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string, for example `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`. | Required for the SQL repositories and `pnpm migrate`. Schema, pool adapter, and migration command are implemented. A database service is not provisioned. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal REST app credentials. | Sandbox credentials are required for Gate 0 characterization and live checkout. Keep PayPal in Sandbox. |
| `PAYPAL_ENV` | `sandbox` or `live`. | Gate 0 is Sandbox only. Do not use live credentials for this prototype. |
| `PAYPAL_RETURN_URL`, `PAYPAL_CANCEL_URL` | Absolute browser destinations for PayPal approval and cancellation. | Set both to the deployed CartAttest `/checkout/return` and `/checkout/cancel` endpoints before browser checkout. |
| `PAYPAL_WEBHOOK_ID` | Webhook ID registered under the same PayPal app. | Signature verification and event processing exist, but there is no running server or public HTTPS callback to register yet. |
| `ATTESTOR_PROVIDER`, `ATTESTOR_MODEL_ID`, `ATTESTOR_API_KEY` | Provider, exact model, and provider key for semantic claims. | No provider adapter is wired. Freeze evaluation inputs before selecting/tuning the model or creating a key. |
| `CARTATTEST_SERVICE_SIGNING_KEY`, `CARTATTEST_SERVICE_KEY_ID` | Service key for signed evidence bundles and future overrides. | Bundle signing/verifying functions exist. Runtime key loading and override issuance are not wired. Do not put a PEM directly in `.env` until the runtime encoding is defined. |
| `DEMO_MODE` | Intended `replay` or `live` runtime. | Runtime composition and replay mode are not implemented. |

## Database

Provision PostgreSQL and set `DATABASE_URL`, then run:

```sh
pnpm migrate
```

The migration command applies `db/0001_checkout.sql` transactionally and records its version. It has not yet been exercised against a live local database in this workspace.

## PayPal Sandbox characterization

Use a Sandbox REST app and buyer. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV=sandbox`, then run:

```sh
pnpm gate0 -- create path/to/cart-binding.json
```

After approval, use the returned order ID with the `get`, `capture`, and `patch` commands in [README.md](README.md). Review patch files before running because they mutate a Sandbox order. Record only sanitized observations from the exact tested flow in `fixtures/paypal/gate0-summary.md`; its current status is not run.

## Webhooks

The code verifies incoming signatures through PayPal's verification API, deduplicates event IDs, and updates matching capture attempts. A server listener and public HTTPS deployment are still required before registering the webhook URL in the PayPal dashboard. Then select the capture event types supported by the processor and save the returned webhook ID in `.env`.

Webhook data is verified at ingestion and stored as a minimal sanitized projection. The original raw event and transmission signature are not retained, so stored events provide ingestion-time authenticity evidence rather than independent offline re-verification.

## Semantic attestor and evaluation freeze

The product/security owner must freeze and retain the private holdout before any provider/model prompt tuning. The builder should receive only its hash. After that, choose a structured-output-capable provider/model, review data handling and cost, set a budget, then create a project-scoped API key. Provider choice, key, and holdout hash are not configured yet.

## Current implementation state

The repository provides domain, policy, evidence, PayPal, persistence, capture reconciliation, webhook, and dependency-injected API modules. The API includes server-side PayPal return/cancel handlers, but there is not yet a runnable HTTP server, buyer UI, trusted STEP-UP decision/override flow, runtime composition for the attestor, or receipt/evaluation pages. Unit tests cover the service boundaries; they do not replace live PostgreSQL, PayPal Sandbox, or end-to-end characterization.
