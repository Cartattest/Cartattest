# Owner setup and run guide

This guide describes the current local app and the owner decisions still needed. Current recorded acceptance: Gates 0, 1, and 3 are complete for the exact Sandbox flows documented in `fixtures/paypal/`. Gate 2 remains incomplete pending the private holdout freeze, provider/model decision, adapter implementation, and evaluation.

## Local setup

Requirements: Node.js 22.x, pnpm 10.29.3, and PostgreSQL.

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm keygen buyer-local-v1 .codex/keys/buyer
pnpm keygen service-local-v1 .codex/keys/service
```

Set `DATABASE_URL` in `.env`, then apply the schema:

```sh
pnpm migrate
```

The key generator refuses to overwrite existing files. Keep `.env` and `.codex/` local. Never commit credentials or private keys.

## Configuration

| Variable | Purpose | Current behavior |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | Required by the server and migrations. |
| `DEMO_MODE` | `sandbox` or `replay` | Defaults to `sandbox`. Replay uses a deterministic simulated PayPal gateway and requires no PayPal credentials. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal REST app credentials | Required in Sandbox mode and by Gate 0 commands. Use Sandbox only. |
| `PAYPAL_ENV` | PayPal environment | Production `live` is rejected; the app supports Sandbox only. |
| `PAYPAL_RETURN_URL`, `PAYPAL_CANCEL_URL` | PayPal browser return/cancel destinations | Required for Sandbox server startup/order creation. They must be reachable by the approving browser. |
| `PAYPAL_MERCHANT_ID` or `PAYPAL_MERCHANT_EMAIL` | Seller/payee identity | Sandbox mode requires one. Replay falls back to the fictional fixture payee. |
| `PAYPAL_WEBHOOK_ID` | Webhook registered to the same PayPal app | Needed for real webhook verification/delivery. Gate 3 acceptance is already recorded; repeat delivery testing needs a public HTTPS endpoint and valid ID. |
| `CARTATTEST_BUYER_KEY_ID`, `CARTATTEST_BUYER_PUBLIC_KEY_PATH` | Trusted public key for Claim Set and override signatures | Defaults to `buyer-local-v1` and `.codex/keys/buyer.public.pem`; matching private key is selected locally in the buyer browser UI. |
| `CARTATTEST_SERVICE_PRIVATE_KEY_PATH`, `CARTATTEST_SERVICE_PUBLIC_KEY_PATH`, `CARTATTEST_SERVICE_KEY_ID` | Evidence receipt signing and verification | Local defaults use the service key pair under `.codex/keys/`. |
| `ATTESTOR_PROVIDER`, `ATTESTOR_API_KEY`, `ATTESTOR_MODEL_ID` | Semantic attestor (AI) | `gemini` is supported. Run `pnpm attestor:check` to verify the key and list models. Unset = semantic claims fail closed as `UNPROVEN`. `ATTESTOR_ENDPOINT` is a test-only override for a local stub. |
| `PORT` | Local HTTP port | Optional; defaults to `3000`. The server binds to `127.0.0.1`. |
| `CARTATTEST_BASE_URL` | Replay E2E base URL | Optional; defaults to `http://127.0.0.1:3000`. The replay script accepts local HTTP hosts only. |

## Run Replay

Replay requires PostgreSQL and the local buyer/service key pairs. It does not contact PayPal or move money.

```sh
DEMO_MODE=replay pnpm start
```

Open `http://127.0.0.1:3000/` for the demo hub. The Buyer Review page requires a Claim Set proposal and local buyer private key. The hub links directly to `/claim-set/review` and `/evaluation`; STEP-UP and receipt pages use IDs created during checkout.

Run the repeatable local flow while the server is available:

```sh
pnpm replay:e2e
```

Expected output includes `REPLAY_E2E_PASS`. It writes signed synthetic checkout records to the configured database. This is local replay evidence, not PayPal Sandbox evidence.

## Run the demo agent

With the server running (Replay or Sandbox), `pnpm demo:agent` signs a Claim Set ("waterproof jacket under GBP 100") and proposes each catalogue jacket. It prints the AI evidence check and CartAttest's decision: an approval URL for an allowed item, or a STEP-UP review link.

## Run PayPal Sandbox

Keep `PAYPAL_ENV=sandbox`. Configure the REST app credentials, seller/payee, and browser-reachable return/cancel URLs in `.env`. Apply migrations, then start:

```sh
pnpm migrate
DEMO_MODE=sandbox pnpm start
```

Open the hub at `http://127.0.0.1:3000/`, create and sign a Claim Set at `/claim-set/review`, and submit an eligible selection. Approve the order with the Sandbox buyer account. Do not use the seller account or a personal production account for approval.

Gate 0's provider observations and Gate 1's successful and mismatch-block flows are already recorded. Review the evidence before repeating a test; use fresh Sandbox orders for any new mutation/capture attempt. The Gate 0 CLI commands are listed in [README.md](README.md).

## Webhooks and Gate 3

The server verifies webhook signatures with PayPal, deduplicates event IDs, and applies matching capture-completion events to persisted checkout state. Sanitized evidence records only the minimal event projection; raw webhook bodies and transmission signatures are not retained for offline re-verification.

Gate 3 live acceptance, duplicate delivery, GET-first reconciliation, and signed receipt verification are recorded in `fixtures/paypal/gate3-summary.md`. To repeat a real delivery test, start the app, expose its `POST /api/webhooks/paypal` route through a public HTTPS endpoint, and register that callback with the same Sandbox PayPal app that supplies `PAYPAL_WEBHOOK_ID`. A quick tunnel URL is temporary and must be checked after every restart.

## Gate 2 and release decisions

The deterministic policy, evidence/provenance handling, signature flow, STEP-UP, 20 development pairs, report command, and evaluation page exist. The semantic adapter and genuine model evaluation do not. Before that work, the product/security owner must privately create and retain the holdout, approve its labels, and provide only its hash to development. Then the owner must choose the provider/model and approve data handling and budget. Do not inspect the holdout or tune against it.

After Gate 2, hosted CI for the latest pushed commit, ownership/IP authorization, and release/deployment decisions remain to be confirmed. Do not treat the current prototype as production-ready.
