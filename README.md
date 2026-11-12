# CartAttest

**Evidence-bound checks for AI shopping agents, before PayPal captures payment.**

- **Live demo** (PayPal sandbox, no real money): https://cartattest.onrender.com/demo
- **Demo video:** https://youtu.be/IwMbwHq5WVE
- **Licence:** Apache 2.0

CartAttest checks an AI shopping agent's product choice against buyer-approved constraints and merchant evidence before creating a PayPal order. It then checks that the PayPal order still matches the admitted cart before capture. Semantic claims (for example "waterproof, not just water-resistant") are checked by a Google Gemini evidence attestor that must quote merchant evidence word for word; deterministic source-authority policy, not the model, decides admission. If the model is unavailable or its quotes don't match the evidence, the claim is treated as unproven and no PayPal order is created.

## Status

| Area | Status |
| --- | --- |
| PayPal checkout (Orders v2, sandbox) | Working: an order is created only after checks pass, the approved order is re-checked before capture, capture is idempotent, and webhooks are verified and reconciled |
| AI evidence checks (Google Gemini) | Working: gemini-3.5-flash with fallbacks; quotes must match the evidence word for word; failures are treated as unproven |
| Signed receipts and decision log | Working: ES256-signed evidence bundles; AG Grid decision log at `/decisions` |
| Hosted demo | Live on Render, deployed from `render.yaml` |
| Tests | 214 automated tests pass (`pnpm test`) |
| Not yet done | Private holdout evaluation of the model (so no accuracy figure is claimed), a production merchant adapter, and buyer signing on the buyer's own device in the hosted demo |

Recorded PayPal sandbox evidence: [Gate 0](fixtures/paypal/gate0-summary.md), [Gate 1](fixtures/paypal/gate1-summary.md), [Gate 3](fixtures/paypal/gate3-summary.md).

## What is implemented

- Buyer-signed Claim Sets and signature verification.
- Deterministic merchant, SKU, variant, quantity, currency, budget, evidence completeness, freshness, and source-authority checks.
- PayPal Orders v2 Sandbox and deterministic Replay gateways.
- CartBinding checks before and after approval, persisted admissions, capture attempts, and GET-first reconciliation.
- Verified, idempotent PayPal webhook ingestion and signed evidence receipts.
- Buyer STEP-UP and receipt pages, an evaluation report view, and a root demo hub.
- PostgreSQL persistence, offline bundle verification, tests, and CI workflows.

Semantic claims use the Gemini attestor when `ATTESTOR_PROVIDER=gemini`, `ATTESTOR_API_KEY` and `ATTESTOR_MODEL_ID` are set; otherwise they fail closed as `UNPROVEN`. Any model failure, invalid output or quote that is not verbatim in the evidence is treated as `UNPROVEN`. The model's verdict and quotes are shown on the STEP-UP page and returned to the agent as `evidenceChecks`. The private holdout evaluation (Gate 2) has not been run, so no accuracy figure is claimed. Replay is synthetic and does not contact PayPal or move money. The fixture merchant catalogue and local signing keys are for development; they are not production trust infrastructure.

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
| `/demo` | Hosted demo only: run the shopping agent from a button (see HOW_TO.md, "Hosted demo on Render") |
| `/decisions` | Decision log (AG Grid): every agent proposal, the AI evidence check and quotes, the decision, and live PayPal status |
| `/evaluation` | Development evaluation report view |
| `/step-up/{sessionId}` | Review an eligible exception created during checkout |
| `/receipt/{bundleId}` | Verify a receipt created during checkout |
| `POST /api/webhooks/paypal` | PayPal capture-completion webhook |

A hosted demo (PayPal sandbox only) can be deployed to Render from `render.yaml`; see HOW_TO.md.

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
