# CartAttest

CartAttest checks an AI shopping agent's product choice against buyer-approved constraints and merchant evidence before creating a PayPal order. It then checks that the PayPal order still matches the admitted cart before capture.

## Delivery status

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Gate 0 — PayPal characterization | Complete for the recorded Sandbox account and flows | [Gate 0 observations](fixtures/paypal/gate0-summary.md) and sanitized fixtures. G0-14 has a local unit-test pass, not a PayPal observation. |
| Gate 1 — Governed checkout | Live Sandbox acceptance complete | Successful checkout/capture and a mutated Binding B blocked before capture: [Gate 1 evidence](fixtures/paypal/gate1-summary.md). |
| Gate 2 — Semantic admission | Incomplete | Deterministic policy, evidence handling, signatures, STEP-UP, development corpus, and report view exist. The owner must freeze the private holdout and decide provider/model; then implement and evaluate a semantic provider adapter. |
| Gate 3 — Evidence and replay | Live Sandbox acceptance complete | Webhook delivery, duplicate delivery, GET-first reconciliation, and receipt verification: [Gate 3 evidence](fixtures/paypal/gate3-summary.md). |
| Hosted CI for current local commits | Not yet confirmed | Push the current branch and confirm both `test` and `secrets` jobs pass. |

The evaluation holdout, provider/model decision, release ownership, and authorization remain owner decisions. Do not use private holdout data for development or tune a model before the evaluation freeze.

## What is implemented

- Buyer-signed Claim Sets and signature verification.
- Deterministic merchant, SKU, variant, quantity, currency, budget, evidence completeness, freshness, and source-authority checks.
- PayPal Orders v2 Sandbox and deterministic Replay gateways.
- CartBinding checks before and after approval, persisted admissions, capture attempts, and GET-first reconciliation.
- Verified, idempotent PayPal webhook ingestion and signed evidence receipts.
- Buyer STEP-UP and receipt pages, an evaluation report view, and a root demo hub.
- PostgreSQL persistence, offline bundle verification, tests, and CI workflows.

Semantic claims currently fail closed as `UNPROVEN`: no semantic provider adapter is wired. Replay is synthetic and does not contact PayPal or move money. The fixture merchant catalogue and local signing keys are for development; they are not production trust infrastructure.

## Requirements and setup

- Node.js 22.x and pnpm 10.29.3
- PostgreSQL
- PayPal Sandbox REST credentials for Sandbox mode; not required for Replay

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm keygen buyer-local-v1 .codex/keys/buyer
pnpm keygen service-local-v1 .codex/keys/service
pnpm migrate
```

Set `DATABASE_URL` in `.env`. For Sandbox mode, also set the Sandbox client credentials, seller payee, and reachable return/cancel URLs. Keep `.env` and `.codex/` local; never commit credentials or private keys. See [HOW_TO.md](HOW_TO.md) for environment variables and detailed run instructions.

## Run the app

```sh
DEMO_MODE=replay pnpm start
# or, with PayPal Sandbox configured:
DEMO_MODE=sandbox pnpm start
```

The server binds to `127.0.0.1:3000` by default. Open `/` for the demo hub. The buyer Claim Set page and evaluation view are also available directly. STEP-UP and receipt pages require IDs created by a checkout.

| Route | Purpose |
| --- | --- |
| `/` | Demo hub with links to Buyer Review and Evaluation |
| `/claim-set/review` | Review and sign buyer requirements |
| `/evaluation` | Development evaluation report view |
| `/step-up/{sessionId}` | Review an eligible exception created during checkout |
| `/receipt/{bundleId}` | Verify a receipt created during checkout |
| `POST /api/webhooks/paypal` | PayPal capture-completion webhook |

Replay uses a labeled simulated approval and never contacts PayPal. A live Sandbox checkout requires a reachable approval return/cancel URL and Sandbox buyer approval. Neither local Replay nor a Sandbox result implies production readiness.

## Useful commands

```sh
pnpm typecheck
pnpm test
pnpm migrate
pnpm replay:e2e             # run while the Replay server is available
pnpm gate0 -- create path/to/cart-binding.json
pnpm gate0 -- get PAYPAL_ORDER_ID
pnpm gate0 -- capture PAYPAL_ORDER_ID PERSISTED_REQUEST_ID
pnpm gate0 -- patch PAYPAL_ORDER_ID path/to/patch.json
pnpm eval:report -- fixtures/evaluation/dev-scenarios.jsonl fixtures/evaluation/dev-inputs.jsonl .codex/evaluation/dev-runs.jsonl .codex/evaluation/dev-report.json
```

The Gate 0 patch command mutates a Sandbox order. Review every patch file and use Sandbox only. Record new provider observations only after running the exact test; do not treat historical observations as universal PayPal behavior.

## Security boundary and limitations

The shopping-agent selection API accepts identifiers. CartAttest resolves price, terms, evidence, source authority, and PayPal actions on the server. PayPal credentials and capture operations stay server-side.

CartAttest does not prove that merchant statements are physically true, protect against a malicious merchant or operator controlling the evidence source, or provide an atomic PayPal compare-and-swap between the final order read and capture. The buyer decision UI assumes the shopping agent cannot automate that trusted origin. The prototype does not replace PayPal buyer approval or guarantee PayPal will reject every possible order mutation.

## Development evaluation

`fixtures/evaluation/` contains 20 synthetic matched development pairs (40 cases) across eight attack families. The report command checks pair/template coverage and scores supplied A/B/C and fail-closed reference run records; it reports unsafe ALLOWs, unnecessary STEP-UPs, instability, errors, and latency percentiles. It does not call a model or freeze evaluation inputs. Do not use it with the private owner holdout.

After a local report is generated at `.codex/evaluation/dev-report.json`, the server exposes aggregate development metrics at `/evaluation` and `GET /api/evaluation/report`. The page shows no-report state when no report file exists; it is not a model result.
