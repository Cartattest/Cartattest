# PayPal Sandbox Gate 0 results

**Status:** NOT RUN — this file contains no PayPal behavior claims yet.

Use `buildpack/spec/GATE0_PAYPAL_TEST_PLAN.md` when running the full characterization. Record only sanitized fixtures; do not commit raw responses, payer data, addresses, access tokens, or credentials. Each result must name the tested Sandbox account/app, UTC date, request shape, response status, observed state, and whether fresh buyer approval was required. Results describe only this tested flow.

## Test environment

| Field | Value |
| --- | --- |
| PayPal environment | Sandbox |
| Test date/time (UTC) | Not run |
| App/account label (non-secret) | Not run |
| API version / endpoint | Orders v2 |
| Buyer approval required | Not run |
| Sanitized fixture directory | `fixtures/paypal/sanitized/` (create after observations) |

## Observation log

| Test | Result | HTTP/status observation | Buyer approval | Sanitized fixture |
| --- | --- | --- | --- | --- |
| G0-01 Vanilla itemized create/approve/capture | NOT RUN | — | — | — |
| G0-02 Created-vs-approved material diff | NOT RUN | — | — | — |
| G0-03 Capture before approval | NOT RUN | — | — | — |
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
| G0-14 Admission expiry blocks capture | NOT RUN | — | — | — |

## Control classification

Fill this from observed results. Do not label a PayPal behavior as a CartAttest control.

| Case | Classification (`PAYPAL CONTROL`, `CARTATTEST CONTROL`, `DEFENSE IN DEPTH`) | Evidence / notes |
| --- | --- | --- |
| Unapproved capture | NOT RUN | — |
| Amount increase | NOT RUN | — |
| Amount decrease | NOT RUN | — |
| Item/SKU substitution | NOT RUN | — |
| Shipping address mutation | NOT RUN | — |
| Duplicate capture | NOT RUN | — |

## Demo decision

**Chosen mutation:** NOT SELECTED — wait for a clean, reproducible sandbox result.

**Reason:** —

## Binding projection

**Created vs approved material projection:** NOT RECORDED.

**Mapping decisions:** —
