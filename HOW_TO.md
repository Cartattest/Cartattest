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
| `DATABASE_URL` | PostgreSQL connection string, for example `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`. | Required for SQL repositories and `pnpm migrate`. The current local database has migrations 0001–0005 applied. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal REST app credentials. | Sandbox credentials are required for Gate 0 characterization and live checkout. Keep PayPal in Sandbox. |
| `PAYPAL_ENV` | `sandbox` or `live`. | Gate 0 is Sandbox only. Do not use live credentials for this prototype. |
| `PAYPAL_RETURN_URL`, `PAYPAL_CANCEL_URL` | Absolute browser destinations for PayPal approval and cancellation. | Set both to the deployed CartAttest `/checkout/return` and `/checkout/cancel` endpoints before browser checkout. |
| `PAYPAL_WEBHOOK_ID` | Webhook ID registered under the same PayPal app. | Optional while starting locally; the webhook route returns 503 until configured. A public HTTPS callback is needed for real delivery. |
| `PAYPAL_MERCHANT_ID` or `PAYPAL_MERCHANT_EMAIL` | Sandbox business account that receives the order. | Set exactly one to the seller account value; buyer credentials are not the payee. |
| `CARTATTEST_BUYER_KEY_ID`, `CARTATTEST_BUYER_PUBLIC_KEY_PATH` | Trusted buyer signing key for Claim Sets and exact overrides. | Defaults to the local-only `buyer-local-v1` key pair under ignored `.codex/keys`; keep the private key local. |
| `ATTESTOR_PROVIDER`, `ATTESTOR_MODEL_ID`, `ATTESTOR_API_KEY` | Provider, exact model, and provider key for semantic claims. | No provider adapter is wired. Freeze evaluation inputs before selecting/tuning the model or creating a key. |
| `CARTATTEST_SERVICE_PRIVATE_KEY_PATH`, `CARTATTEST_SERVICE_PUBLIC_KEY_PATH`, `CARTATTEST_SERVICE_KEY_ID` | Service key for signed evidence bundles. | Local defaults point into ignored `.codex/keys`; generate the pair with `pnpm keygen service-local-v1 .codex/keys/service`. |
| `DEMO_MODE` | `sandbox` or deterministic `replay`. | Defaults to Sandbox. Replay uses the recorded G0-01 approval/capture statuses with synthetic local order data; it never contacts PayPal or moves money. |

## Database

Provision PostgreSQL and set `DATABASE_URL`, then run:

```sh
pnpm migrate
```

The migration command applies all versioned SQL files transactionally and records their versions. It has been run against the local PostgreSQL instance.

## Local sandbox server

The local browser flow is available at `/claim-set/review`; it displays the normalized constraints, signs them in-browser, and stores the Claim Set only after server verification. Keep the local `.private.pem` keys in ignored `.codex/keys`; never commit or upload them. Generate the service receipt key as described above. Configure the PayPal Sandbox app credentials, seller payee, and public HTTPS return/cancel URLs, then run:

    pnpm migrate
    pnpm start

The local server binds to 127.0.0.1 and rejects `PAYPAL_ENV=live`. Until an attestor provider is selected after the evaluation freeze, semantic claims return UNPROVEN; deterministic claims can use the PayPal Sandbox checkout rails.

For a no-PayPal replay, set `DEMO_MODE=replay` and run `pnpm start`. The replay screen labels approval as simulated, then the same Binding B, capture persistence, and receipt path run against a deterministic in-memory gateway. This checks local product flow, not PayPal Sandbox behavior. Replay still requires PostgreSQL and the buyer signing public key.

With the replay server running, `pnpm replay:e2e` signs a synthetic deterministic Claim Set with the local buyer key, submits an eligible fixture selection, approves the simulated order, runs capture/reconciliation, and verifies the resulting receipt bundle against the local service key. It leaves signed test records in the local database.

## PayPal Sandbox characterization

Use a Sandbox REST app and buyer. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_ENV=sandbox`, then run:

```sh
pnpm gate0 -- create path/to/cart-binding.json
```

After approval, use the returned order ID with the `get`, `capture`, and `patch` commands in [README.md](README.md). Review patch files before running because they mutate a Sandbox order. Record only sanitized observations from the exact tested flow in `fixtures/paypal/gate0-summary.md`; Gate 0 remains in progress.

## Webhooks

The code verifies incoming signatures through PayPal's verification API, deduplicates event IDs, and updates matching capture attempts. A server listener and public HTTPS deployment are still required before registering the webhook URL in the PayPal dashboard. Then select the capture event types supported by the processor and save the returned webhook ID in `.env`.

Webhook data is verified at ingestion and stored as a minimal sanitized projection. The original raw event and transmission signature are not retained, so stored events provide ingestion-time authenticity evidence rather than independent offline re-verification.

## Semantic attestor and evaluation freeze

The product/security owner must freeze and retain the private holdout before any provider/model prompt tuning. The builder should receive only its hash. After that, choose a structured-output-capable provider/model, review data handling and cost, set a budget, then create a project-scoped API key. Provider choice, key, and holdout hash are not configured yet.

## Current implementation state

The repository provides a runnable PayPal Sandbox or deterministic replay HTTP server, domain/policy/evidence modules, PostgreSQL persistence, capture reconciliation, webhook verification, buyer signature checks, an offline bundle verifier, and Claim Set, STEP-UP, replay approval, and receipt pages. The local PostgreSQL replay E2E passes. It does not replace a real PayPal Sandbox/browser E2E or complete Gate 0 characterization.
