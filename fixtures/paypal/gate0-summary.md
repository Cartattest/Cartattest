# PayPal Sandbox Gate 0 results

**Status:** IN PROGRESS — G0-01 through G0-09, G0-11 through G0-13 are recorded; G0-10 intent mutation is recorded, but payee mutation remains untested. G0-09 now confirms that adding a second purchase unit through the existing `default` reference is accepted. The provider omitted the create-time shipping-preference projection on both G0-02 GETs. G0-13's persisted retry behavior has existing local test coverage, not rerun here.

Use `buildpack/spec/GATE0_PAYPAL_TEST_PLAN.md` when running the full characterization. Record only sanitized fixtures; do not commit raw responses, payer data, addresses, access tokens, or credentials. Each result must name the tested Sandbox account/app, UTC date, request shape, response status, observed state, and whether fresh buyer approval was required. Results describe only this tested flow.

## Test environment

| Field | Value |
| --- | --- |
| PayPal environment | Sandbox |
| Latest observation (UTC) | 2026-10-23 20:27 UTC; see sanitized fixtures for each test time |
| App/account label (non-secret) | Sandbox app; label not recorded |
| API version / endpoint | Orders v2 |
| Buyer approval required | Yes; G0-01 order currently requires payer action |
| Sanitized fixture directory | `fixtures/paypal/sanitized/` |

## Observation log

| Test | Result | HTTP/status observation | Buyer approval | Sanitized fixture |
| --- | --- | --- | --- | --- |
| G0-01 Vanilla itemized create/approve/capture | OBSERVED, projection incomplete | Order reached `APPROVED`; capture returned `COMPLETED`; follow-up GET returned `COMPLETED`. GET omitted the create-time shipping preference. Binding B uses the persisted admission value only for that omitted field; an explicit different preference remains a failure. The observation still needs to be recorded in the material projection mapping. | Yes | `sanitized/g0-01-approved-capture.json` |
| G0-02 Created-vs-approved material diff | OBSERVED | Pre-approval GET returned `PAYER_ACTION_REQUIRED`; approved-side GET returned `APPROVED`. Both omitted `shipping_preference`; material bindings matched the create binding using the persisted preference. | Yes | `sanitized/g0-02-created-projection.json`; `sanitized/g0-02-approved-projection.json` |
| G0-03 Capture before approval | OBSERVED | HTTP 422 `UNPROCESSABLE_ENTITY`, issue `ORDER_NOT_APPROVED`; order remained `PAYER_ACTION_REQUIRED` | Not approved | `sanitized/g0-03-unapproved-capture.json` |
| G0-04 Increase amount after approval | OBSERVED | PATCH accepted with HTTP 204; capture returned HTTP 422 `UNPROCESSABLE_ENTITY`, issue `PAYER_ACTION_REQUIRED`; follow-up GET returned `PAYER_ACTION_REQUIRED`. Fresh buyer action required. No capture completed. | Yes; order was approved, then reapproval became required after mutation | `sanitized/g0-04-amount-increase.json` |
| G0-05 Decrease amount after approval | OBSERVED | After the buyer approved the GBP 26.50 order, PATCH reduced it to GBP 24.50 (204); capture completed for GBP 24.50 without another approval after the decrease; follow-up GET returned `COMPLETED`. | Yes; buyer approved the GBP 26.50 order before the decrease | `sanitized/g0-05-amount-decrease.json` |
| G0-06 Same-total item/SKU substitution | OBSERVED | PATCH accepted with HTTP 204; PayPal retained GBP 25.50 total with the substituted item/SKU, and capture completed for GBP 25.50. This direct provider test did not exercise CartAttest's Binding mismatch block. | Yes | `sanitized/g0-06-same-total-item-substitution.json` |
| G0-07 Quantity/unit-price change preserving total | OBSERVED | PATCH accepted with HTTP 204; quantity changed from 1 to 2, unit price from GBP 20.00 to GBP 10.00, per-item tax from GBP 2.00 to GBP 1.00; total and completed capture remained GBP 25.50. CartAttest was not in this direct test. | Yes | `sanitized/g0-07-quantity-unit-price.json` |
| G0-08 Shipping address mutation | OBSERVED | PATCH accepted with HTTP 204; follow-up GET showed the changed address (details redacted); capture completed for GBP 25.50. CartAttest was not in this direct test. | Yes | `sanitized/g0-08-shipping-address-mutation.json` |
| G0-09 Purchase-unit expansion | OBSERVED | On a fresh approved one-unit order, `add` at `/purchase_units/@reference_id=='default'` returned HTTP 204. Follow-up GET showed two units: the new GBP 1.00 test unit and the original GBP 25.50 unit. Order remained `APPROVED`; no capture attempted. Earlier root/index paths and a new-reference selector had failed. | Yes | `sanitized/g0-09-purchase-unit-expansion.json` |
| G0-10 Payee/intent mutation | OBSERVED (intent) | PATCH from `CAPTURE` to `AUTHORIZE` returned HTTP 422 `UNPROCESSABLE_ENTITY`, issue `CANNOT_MODIFY_INTENT`; follow-up GET remained `APPROVED` with intent `CAPTURE`. Payee mutation not attempted. | Yes | `sanitized/g0-10-intent-mutation.json` |
| G0-11 Duplicate capture | OBSERVED | Second capture attempt returned HTTP 422 `UNPROCESSABLE_ENTITY`, issue `ORDER_ALREADY_CAPTURED`; follow-up GET remained `COMPLETED`. | Already approved/captured | `sanitized/g0-11-duplicate-capture.json` |
| G0-12 `custom_id` mutation | OBSERVED | PATCH accepted with HTTP 204; follow-up GET showed `custom_id` present. No capture attempted. Existing binding test confirms this field is excluded from the CartAttest material projection. | Yes | `sanitized/g0-12-custom-id-mutation.json` |
| G0-13 Ambiguous capture reconciliation | OBSERVED (live reconciliation) | Capture request was dispatched with a PayPal-Request-Id; the test wrapper dropped the client response after receiving HTTP 201. Reconciliation GET returned `COMPLETED`, capture `COMPLETED` GBP 25.50; no retry was appropriate. Existing local test asserts a persisted unknown attempt retries only after GET still shows `APPROVED` and reuses its request ID; test not rerun here. | Yes | `sanitized/g0-13-ambiguous-capture-reconciliation.json` |
| G0-14 Admission expiry blocks capture | LOCAL PASS | Unit test confirms expiry blocks before PayPal GET (`tests/binding-checks.test.mjs`) | N/A | — |

## Control classification

Fill this from observed results. Do not label a PayPal behavior as a CartAttest control.

| Case | Classification (`PAYPAL CONTROL`, `CARTATTEST CONTROL`, `DEFENSE IN DEPTH`) | Evidence / notes |
| --- | --- | --- |
| Unapproved capture | PAYPAL CONTROL | PayPal Sandbox returned `ORDER_NOT_APPROVED` before payer approval. |
| Amount increase | PAYPAL CONTROL / DEFENSE IN DEPTH | Sandbox accepted the patched amount but capture required fresh payer action (`PAYER_ACTION_REQUIRED`). This is an observation for this exact Sandbox flow. |
| Amount decrease | PAYPAL CONTROL | Sandbox captured the decreased GBP 24.50 amount after buyer approval of the GBP 26.50 order; exact tested flow only. |
| Item/SKU substitution | CARTATTEST CONTROL (pending Gate 1 verification) | PayPal Sandbox accepted the same-total item/SKU mutation and completed capture in this direct test. Verify CartAttest blocks capture for the Binding mismatch in Gate 1. |
| Quantity/unit-price mutation | CARTATTEST CONTROL (pending Gate 1 verification) | PayPal Sandbox accepted the changed quantity and unit price and completed capture at the unchanged total in this direct test. Verify CartAttest blocks the Binding mismatch in Gate 1. |
| Shipping address mutation | CARTATTEST CONTROL (pending Gate 1 verification) | PayPal Sandbox accepted the changed address and completed capture in this direct test. Verify CartAttest blocks capture for the Binding mismatch in Gate 1. |
| Purchase-unit expansion | PAYPAL ALLOWS; CARTATTEST GUARD NEEDS LIVE CONFIRMATION | Sandbox accepted insertion before the existing `default` unit and returned two units. Local binding projection rejects any count other than one (`UNSUPPORTED_PURCHASE_UNIT_COUNT`); no live CartAttest capture-block test was run for this mutation. No capture attempted. |
| Intent mutation | PAYPAL CONTROL | Sandbox rejected the intent change with `CANNOT_MODIFY_INTENT` on this approved order. Payee mutation not attempted. |
| Duplicate capture | PAYPAL CONTROL | Sandbox rejected the second capture with `ORDER_ALREADY_CAPTURED`; follow-up GET remained `COMPLETED`. |
| `custom_id` mutation | CARTATTEST CONTROL | Sandbox accepted metadata mutation; source mapper and existing unit test exclude it from the material binding. |
| Ambiguous capture | CARTATTEST CONTROL (existing local coverage) | Live Sandbox response-loss simulation reconciled to `COMPLETED` by GET; existing local code/test covers reusing a persisted request ID on retry when GET remains `APPROVED`. |
| Duplicate capture | NOT RUN | — |

## Demo decision

**Chosen mutation:** G0-06 same-total item/SKU substitution is the leading demo candidate; confirm CartAttest blocks capture for the Binding mismatch in Gate 1 before using it.

**Reason:** PayPal Sandbox accepted the mutation and completed same-total capture in this tested flow. The CartAttest control still needs live Gate 1 verification.

## Binding projection

**Created vs approved material projection:** NOT RECORDED.

**Mapping decisions:** —

**G0-01 follow-up:** Sandbox buyer approval and capture succeeded on 2026-10-20. This is a positive observation for the exact tested flow only. PayPal GET omitted the create-time shipping preference; CartAttest retains the persisted requested value for that omission, and rejects an explicitly conflicting returned value. Record the omission as an observed projection limitation; do not imply PayPal returned the preference. Gate 0 remains incomplete pending the comparisons and remaining cases below.

**G0-02 follow-up (2026-10-21):** Buyer approved fresh order `5H467160G6251084G`. The approved-side GET returned `APPROVED` and also omitted `shipping_preference`. A comparison of the approved material projection with the persisted create binding matched, allowing the persisted `SET_PROVIDED_ADDRESS` value only for the field PayPal omitted. Sanitized approved-side projection is recorded in `sanitized/g0-02-approved-projection.json`; no capture was performed for this comparison.

**G0-04 follow-up (2026-10-21):** On the G0-02 order after its approved-side projection was recorded, the amount was increased from GBP 25.50 to GBP 26.50 with a balanced breakdown. PayPal accepted the PATCH (204), but capture returned 422 `PAYER_ACTION_REQUIRED`; follow-up GET confirmed the order returned to `PAYER_ACTION_REQUIRED`. No capture completed. The approval URL is available from the current Sandbox session; a new buyer approval is required before continuing with G0-05.

**G0-05 follow-up (2026-10-21):** After the buyer approved the GBP 26.50 order, the total was reduced to GBP 24.50 with a balanced breakdown. PayPal accepted the PATCH (204); capture completed for GBP 24.50, and follow-up GET returned `COMPLETED`. PayPal did not require another buyer approval after this decrease in this exact flow. No additional claim is made about other account/order configurations.

**G0-06 follow-up (2026-10-22):** On a fresh approved order, the item was replaced with `Fictional Trail Shell` / `SHELL-RED-M` at the same unit price and quantity, preserving the GBP 25.50 total. PayPal accepted the PATCH (204), the GET showed the substituted item, and capture completed at GBP 25.50. This direct Gateway test did not exercise CartAttest's Binding comparison; Gate 1 must prove that CartAttest blocks capture for the mismatch.

**G0-07 follow-up (2026-10-22):** On a fresh approved order, quantity changed from 1 to 2, unit price from GBP 20.00 to GBP 10.00, and per-item tax from GBP 2.00 to GBP 1.00, preserving GBP 25.50 total. PayPal accepted the PATCH (204), and capture completed at GBP 25.50. This direct Gateway test did not exercise CartAttest's Binding comparison; Gate 1 must verify its mismatch block.

**G0-08 follow-up (2026-10-22):** On a fresh approved order, the shipping address was replaced with a different fictional test address. PayPal accepted the PATCH (204); follow-up GET confirmed the address differed from the persisted binding, and capture completed at GBP 25.50. The address itself is redacted. This direct Gateway test did not exercise CartAttest's Binding comparison; Gate 1 must verify its mismatch block.

**G0-10 follow-up (2026-10-22):** On the approved one-unit order, an attempt to change `intent` from `CAPTURE` to `AUTHORIZE` returned HTTP 422 `CANNOT_MODIFY_INTENT`. Follow-up GET showed the order remained `APPROVED` with intent `CAPTURE`. Payee mutation was not attempted.

**G0-09 follow-up (2026-10-23):** After the Sandbox buyer approved a fresh GBP 25.50 order, `PATCH add /purchase_units/@reference_id=='default'` inserted a second purchase unit for GBP 1.00. PayPal returned HTTP 204; follow-up GET returned `APPROVED` with two units (GBP 1.00 and GBP 25.50). No capture was attempted. The earlier attempts targeted `/purchase_units/-`, `/purchase_units`, `/purchase_units/1`, and a nonexistent reference; they do not contradict this successful selector-based insertion. The local binding mapper rejects the resulting two-unit order, but live CartAttest rejection remains to be verified separately.

**G0-11 follow-up (2026-10-22):** A second capture attempt on the completed G0-08 order returned HTTP 422 `ORDER_ALREADY_CAPTURED`; follow-up GET remained `COMPLETED`.

**G0-12 follow-up (2026-10-22):** PayPal accepted adding `custom_id` to the approved G0-09 order (HTTP 204); follow-up GET showed the value present. The binding mapper does not project this metadata, and an existing unit test asserts that changing `custom_id` does not change the material binding. No capture was attempted.

**G0-13 follow-up (2026-10-22):** A live Sandbox capture request was dispatched with a PayPal-Request-Id through a test wrapper that dropped the response after receiving HTTP 201. A fresh GET returned order and capture status `COMPLETED` at GBP 25.50; no retry was sent. The application service and existing unit test cover persisted unknown-attempt GET reconciliation and reuse of the stored request ID if the order is still `APPROVED`; that test was not run in this session.
