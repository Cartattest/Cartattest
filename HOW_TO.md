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
| `PAYPAL_WEBHOOK_ID` | Webhook ID registered under the same PayPal app. | Optional while starting locally; the webhook route returns 503 until configured. A public HTTPS callback is needed for real delivery. |
| `PAYPAL_MERCHANT_ID` or `PAYPAL_MERCHANT_EMAIL` | Sandbox business account that receives the order. | Set exactly one to the seller account value; buyer credentials are not the payee. |
| `CARTATTEST_BUYER_KEY_ID`, `CARTATTEST_BUYER_PUBLIC_KEY_PATH` | Trusted buyer signing key for ClaimSets and exact overrides. | Generate a local pair with `pnpm keygen buyer-local .codex/keys/buyer`; keep the private key local. |
| `ATTESTOR_PROVIDER`, `ATTESTOR_MODEL_ID`, `ATTESTOR_API_KEY` | Provider, exact model, and provider key for semantic claims. | No provider adapter is wired. Freeze evaluation inputs before selecting/tuning the model or creating a key. |
| `CARTATTEST_SERVICE_PRIVATE_KEY_PATH`, `CARTATTEST_SERVICE_PUBLIC_KEY_PATH`, `CARTATTEST_SERVICE_KEY_ID` | Service key for signed evidence bundles. | Local defaults point into ignored `.codex/keys`; generate the pair with `pnpm keygen service-local-v1 .codex/keys/service`. |
| `DEMO_MODE` | `sandbox` or deterministic `replay`. | Defaults to Sandbox. Replay uses the recorded G0-01 approval/capture statuses with synthetic local order data; it never contacts PayPal or moves money. |

## Database

Provision PostgreSQL and set `DATABASE_URL`, then run:

```sh
pnpm migrate
```

The migration command applies `db/0001_checkout.sql` transactionally and records its version. It has not yet been exercised against a live local database in this workspace.

## Local sandbox server

Generate a buyer key and set `CARTATTEST_BUYER_KEY_ID` and `CARTATTEST_BUYER_PUBLIC_KEY_PATH` in `.env`. Keep the matching `.private.pem` file local; never commit or upload it. Generate the service receipt key as described above. Configure the PayPal Sandbox app credentials, seller payee, and public HTTPS return/cancel URLs, then run:

    pnpm migrate
    pnpm start

The local server binds to 127.0.0.1 and rejects `PAYPAL_ENV=live`. Until an attestor provider is selected after the evaluation freeze, semantic claims return UNPROVEN; deterministic claims can use the PayPal Sandbox checkout rails.

For a no-PayPal replay, set `DEMO_MODE=replay` and run `pnpm start`. The replay screen labels approval as simulated, then the same Binding B, capture persistence, and receipt path run against a deterministic in-memory gateway. This checks local product flow, not PayPal Sandbox behavior. Replay still requires PostgreSQL and the buyer signing public key.

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

The repository provides a runnable PayPal Sandbox or deterministic replay HTTP server, domain/policy/evidence modules, PostgreSQL persistence, capture reconciliation, webhook verification, buyer signature checks, an offline bundle verifier, and Claim Set, STEP-UP, replay approval, and receipt pages. Unit tests do not replace live PostgreSQL, PayPal Sandbox, or browser end-to-end characterization.
