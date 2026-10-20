# PayPal Sandbox Gate 0 results

**Status:** IN PROGRESS — G0-03 recorded; G0-01 is waiting for Sandbox buyer approval and capture.

Use `buildpack/spec/GATE0_PAYPAL_TEST_PLAN.md` when running the full characterization. Record only sanitized fixtures; do not commit raw responses, payer data, addresses, access tokens, or credentials. Each result must name the tested Sandbox account/app, UTC date, request shape, response status, observed state, and whether fresh buyer approval was required. Results describe only this tested flow.

## Test environment

| Field | Value |
| --- | --- |
| PayPal environment | Sandbox |
| Test date/time (UTC) | 2026-10-20 17:08 UTC |
| App/account label (non-secret) | Sandbox app; label not recorded |
| API version / endpoint | Orders v2 |
| Buyer approval required | Yes; G0-01 order currently requires payer action |
| Sanitized fixture directory | `fixtures/paypal/sanitized/` |

## Observation log

| Test | Result | HTTP/status observation | Buyer approval | Sanitized fixture |
| --- | --- | --- | --- | --- |
| G0-01 Vanilla itemized create/approve/capture | IN PROGRESS | Create + GET returned `PAYER_ACTION_REQUIRED`; approval/capture pending | Yes | — |
| G0-02 Created-vs-approved material diff | NOT RUN | — | — | — |
| G0-03 Capture before approval | OBSERVED | HTTP 422 `UNPROCESSABLE_ENTITY`, issue `ORDER_NOT_APPROVED`; order remained `PAYER_ACTION_REQUIRED` | Not approved | `sanitized/g0-03-unapproved-capture.json` |
| G0-04 Increase amount after approval | NOT RUN | — | — | — |
| G0-05 Decrease amount after approval | NOT RUN | — | — | — |
| G0-06 Same-total item/SKU substitution | NOT RUN | — | — | — |
| G0-07 Quantity/unit-price change preserving total | NOT RUN | — | — | — |
| G0-08 Shipping address mutation | NOT RUN | — | — | — |
| G0-09 Purchase-unit expansion | NOT RUN | — | — | — |
| G0-10 Payee/intent mutation | NOT RUN | — | — | — |
| G0-11 Duplicate capture | NOT RUN | — | — | — |
| G0-12 `custom_id` mutation | NOT RUN | — | — | — |
| G0-13 Ambiguous capture reconciliation | NOT RUN | — | — | — |
| G0-14 Admission expiry blocks capture | LOCAL PASS | Unit test confirms expiry blocks before PayPal GET (`tests/binding-checks.test.mjs`) | N/A | — |

## Control classification

Fill this from observed results. Do not label a PayPal behavior as a CartAttest control.

| Case | Classification (`PAYPAL CONTROL`, `CARTATTEST CONTROL`, `DEFENSE IN DEPTH`) | Evidence / notes |
| --- | --- | --- |
| Unapproved capture | PAYPAL CONTROL | PayPal Sandbox returned `ORDER_NOT_APPROVED` before payer approval. |
| Amount increase | NOT RUN | — |
| Amount decrease | NOT RUN | — |
| Item/SKU substitution | NOT RUN | — |
| Shipping address mutation | NOT RUN | — |
| Duplicate capture | NOT RUN | — |

## Demo decision

**Chosen mutation:** NOT SELECTED — wait for a clean, reproducible sandbox result.

**Reason:** Waiting for the buyer-approved G0-01 round trip and mutation observations.

## Binding projection

**Created vs approved material projection:** NOT RECORDED.

**Mapping decisions:** —
