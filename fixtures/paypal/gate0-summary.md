# PayPal Sandbox Gate 0 results

**Status:** COMPLETE (2026-10-24) — G0-01 through G0-13 are recorded, G0-14 has a local pass, the material projection mapping and control matrix are recorded, and G0-06 same-total item/SKU substitution was used in the live Gate 1 demo. Gate 1 confirmed CartAttest blocks that mutation before capture; see `gate1-summary.md`. G0-09 confirms that adding a second purchase unit through the existing `default` reference is accepted. PayPal omitted the create-time shipping-preference projection on both G0-02 GETs.

If extending or repeating the characterization, use fresh Sandbox orders and define the exact request and expected observation before testing. Retain only sanitized fixtures; do not commit raw responses, payer data, addresses, access tokens, or credentials. Record the non-secret app/account label, UTC date, request shape, response status, observed state, and whether fresh buyer approval was required. Results describe only the tested flow.

## Test environment

| Field | Value |
| --- | --- |
| PayPal environment | Sandbox |
| Latest observation (UTC) | 2026-10-24 12:49 UTC; see sanitized fixtures for each test time |
| App/account label (non-secret) | Sandbox app; label not recorded |
| API version / endpoint | Orders v2 |
| Buyer approval required | Yes; buyer approval was required and completed on the characterization orders marked above |
| Sanitized fixture directory | `fixtures/paypal/sanitized/` |

## Observation log

| Test | Result | HTTP/status observation | Buyer approval | Sanitized fixture |
| --- | --- | --- | --- | --- |
| G0-01 Vanilla itemized create/approve/capture | OBSERVED | Order reached `APPROVED`; capture returned `COMPLETED`; follow-up GET returned `COMPLETED`. GET omitted the create-time shipping preference. G0-02 established the material projection match using the persisted create value only for that omission; focused tests verify omission fallback and explicit-conflict rejection. | Yes | `sanitized/g0-01-approved-capture.json` |
| G0-02 Created-vs-approved material diff | OBSERVED | Pre-approval GET returned `PAYER_ACTION_REQUIRED`; approved-side GET returned `APPROVED`. Both omitted `shipping_preference`; material bindings matched the create binding using the persisted preference. | Yes | `sanitized/g0-02-created-projection.json`; `sanitized/g0-02-approved-projection.json` |
| G0-03 Capture before approval | OBSERVED | HTTP 422 `UNPROCESSABLE_ENTITY`, issue `ORDER_NOT_APPROVED`; order remained `PAYER_ACTION_REQUIRED` | Not approved | `sanitized/g0-03-unapproved-capture.json` |
| G0-04 Increase amount after approval | OBSERVED | PATCH accepted with HTTP 204; capture returned HTTP 422 `UNPROCESSABLE_ENTITY`, issue `PAYER_ACTION_REQUIRED`; follow-up GET returned `PAYER_ACTION_REQUIRED`. Fresh buyer action required. No capture completed. | Yes; order was approved, then reapproval became required after mutation | `sanitized/g0-04-amount-increase.json` |
| G0-05 Decrease amount after approval | OBSERVED | After the buyer approved the GBP 26.50 order, PATCH reduced it to GBP 24.50 (204); capture completed for GBP 24.50 without another approval after the decrease; follow-up GET returned `COMPLETED`. | Yes; buyer approved the GBP 26.50 order before the decrease | `sanitized/g0-05-amount-decrease.json` |
| G0-06 Same-total item/SKU substitution | OBSERVED | PATCH accepted with HTTP 204; PayPal retained GBP 25.50 total with the substituted item/SKU, and capture completed for GBP 25.50. This direct provider test did not exercise CartAttest's Binding mismatch block. | Yes | `sanitized/g0-06-same-total-item-substitution.json` |
| G0-07 Quantity/unit-price change preserving total | OBSERVED | PATCH accepted with HTTP 204; quantity changed from 1 to 2, unit price from GBP 20.00 to GBP 10.00, per-item tax from GBP 2.00 to GBP 1.00; total and completed capture remained GBP 25.50. CartAttest was not in this direct test. | Yes | `sanitized/g0-07-quantity-unit-price.json` |
| G0-08 Shipping address mutation | OBSERVED | PATCH accepted with HTTP 204; follow-up GET showed the changed address (details redacted); capture completed for GBP 25.50. CartAttest was not in this direct test. | Yes | `sanitized/g0-08-shipping-address-mutation.json` |
| G0-09 Purchase-unit expansion | OBSERVED | On a fresh approved one-unit order, `add` at `/purchase_units/@reference_id=='default'` returned HTTP 204. Follow-up GET showed two units: the new GBP 1.00 test unit and the original GBP 25.50 unit. Order remained `APPROVED`; no capture attempted. Earlier root/index paths and a new-reference selector had failed. | Yes | `sanitized/g0-09-purchase-unit-expansion.json` |
| G0-10 Payee/intent mutation | OBSERVED (intent and payee) | Intent PATCH from `CAPTURE` to `AUTHORIZE` returned HTTP 422 `CANNOT_MODIFY_INTENT`; order stayed `APPROVED` with `CAPTURE`. Payee email PATCH to a second controlled Sandbox business account returned HTTP 204; GET returned HTTP 200 with status `APPROVED`, intent `CAPTURE`, and the new payee. No capture attempted. | Yes | `sanitized/g0-10-intent-mutation.json`; `sanitized/g0-10-payee-mutation.json` |
| G0-11 Duplicate capture | OBSERVED | Second capture attempt returned HTTP 422 `UNPROCESSABLE_ENTITY`, issue `ORDER_ALREADY_CAPTURED`; follow-up GET remained `COMPLETED`. | Already approved/captured | `sanitized/g0-11-duplicate-capture.json` |
| G0-12 `custom_id` mutation | OBSERVED | PATCH accepted with HTTP 204; follow-up GET showed `custom_id` present. No capture attempted. Existing binding test confirms this field is excluded from the CartAttest material projection. | Yes | `sanitized/g0-12-custom-id-mutation.json` |
| G0-13 Ambiguous capture reconciliation | OBSERVED (live and local) | Capture request was dispatched with a PayPal-Request-Id; the test wrapper dropped the client response after receiving HTTP 201. Reconciliation GET returned `COMPLETED`, capture `COMPLETED` GBP 25.50; no retry was appropriate. Focused local tests pass for completed/pending reconciliation and retry only after GET still shows `APPROVED`, reusing the persisted request ID. | Yes | `sanitized/g0-13-ambiguous-capture-reconciliation.json` |
| G0-14 Admission expiry blocks capture | LOCAL PASS | Unit test confirms expiry blocks before PayPal GET (`tests/binding-checks.test.mjs`) | N/A | — |

## Control classification

Fill this from observed results. Do not label a PayPal behavior as a CartAttest control.

| Case | Classification (`PAYPAL CONTROL`, `CARTATTEST CONTROL`, `DEFENSE IN DEPTH`) | Evidence / notes |
| --- | --- | --- |
| Unapproved capture | PAYPAL CONTROL | PayPal Sandbox returned `ORDER_NOT_APPROVED` before payer approval. |
| Amount increase | PAYPAL CONTROL / DEFENSE IN DEPTH | Sandbox accepted the patched amount but capture required fresh payer action (`PAYER_ACTION_REQUIRED`). This is an observation for this exact Sandbox flow. |
| Amount decrease | PAYPAL CONTROL | Sandbox captured the decreased GBP 24.50 amount after buyer approval of the GBP 26.50 order; exact tested flow only. |
| Item/SKU substitution | CARTATTEST CONTROL (live Gate 1 case) | PayPal Sandbox accepted the same-total item/SKU mutation and completed capture in the direct Gate 0 test. In Gate 1, CartAttest returned `CART_BINDING_MISMATCH`, marked the admission `ABORTED`, and made no capture attempt after the buyer approved the mutated order. |
| Quantity/unit-price mutation | CARTATTEST CONTROL (projection tests; live scenario not run) | PayPal Sandbox accepted the changed quantity and unit price and completed capture at the unchanged total in the direct test. Binding tests cover these material fields; the live Gate 1 mutation changed item/SKU, not quantity/unit price. |
| Shipping address mutation | CARTATTEST CONTROL (projection tests; live scenario not run) | PayPal Sandbox accepted the changed address and completed capture in the direct test. Binding tests cover the address; the live Gate 1 mutation changed item/SKU. |
| Purchase-unit expansion | CARTATTEST CONTROL (projection test; live scenario not run) | Sandbox accepted insertion before the existing `default` unit and returned two units. Local binding projection rejects any count other than one (`UNSUPPORTED_PURCHASE_UNIT_COUNT`); the live Gate 1 test used a one-unit item/SKU mutation. No capture attempted in G0-09. |
| Intent mutation | PAYPAL CONTROL | Sandbox rejected the intent change with `CANNOT_MODIFY_INTENT` on this approved order. |
| Payee mutation | PAYPAL ALLOWS; CARTATTEST BINDING DEFENSE COVERED BY PROJECTION TESTS | Sandbox accepted the payee-email change (204) and returned `APPROVED` on GET. Binding projection tests cover the payee; the live Gate 1 mutation changed item/SKU, so live payee-mutation blocking was not separately exercised. No capture attempted in G0-10. |
| Duplicate capture | PAYPAL CONTROL | Sandbox rejected the second capture with `ORDER_ALREADY_CAPTURED`; follow-up GET remained `COMPLETED`. |
| `custom_id` mutation | CARTATTEST CONTROL | Sandbox accepted metadata mutation; source mapper and existing unit test exclude it from the material binding. |
| Ambiguous capture | CARTATTEST CONTROL (existing local coverage) | Live Sandbox response-loss simulation reconciled to `COMPLETED` by GET; existing local code/test covers reusing a persisted request ID on retry when GET remains `APPROVED`. |

## Demo decision

**Chosen mutation:** G0-06 same-total item/SKU substitution was used for the live Gate 1 demonstration. CartAttest blocked capture after buyer approval with `CART_BINDING_MISMATCH`.

**Reason:** PayPal Sandbox accepted the mutation and completed same-total capture in this tested flow; the live Gate 1 checkout confirmed CartAttest blocks the same mutation before capture.

## Binding projection

**Created vs approved material projection:** RECORDED. On G0-02, the pre-approval and approved projections matched the persisted create binding for returned material fields. PayPal omitted shipping preference in both GETs; only that absent value came from the persisted create binding. G0-01's post-capture GET showed the same omission.

**CartBindingV1 field mapping:**

| CartBindingV1 field | PayPal Orders v2 projection | Mapping rule and observation |
| --- | --- | --- |
| `intent` | `intent` | Must equal `CAPTURE`; an approved-order attempt to change it to `AUTHORIZE` was rejected with `CANNOT_MODIFY_INTENT`. |
| `purchaseUnitCount` | `purchase_units.length` | Exactly one is supported; a different count is rejected by CartAttest. |
| `payee` | `purchase_units[0].payee.merchant_id` or `.email_address` | Use merchant ID when returned; otherwise bind the payee email. G0-10 showed PayPal accepts changing the email after approval, so Binding B must compare it. |
| `currency` | `purchase_units[0].amount.currency_code` | Bind the returned three-letter currency. |
| `amountBreakdown` | `purchase_units[0].amount.value` and `.amount.breakdown.{item_total,tax_total,shipping,handling,insurance,shipping_discount,discount}` | Bind total and all components. An absent optional component normalizes to `0.00`; mismatched currencies and malformed money are rejected. |
| `shipping.preference` | `application_context.shipping_preference` or `payment_source.paypal.experience_context.shipping_preference` | Both tested GETs omitted this field. Only when absent, reuse persisted create-time `SET_PROVIDED_ADDRESS`; reject an explicit conflicting value. |
| `shipping.name` | `purchase_units[0].shipping.name.full_name` | Bind the returned recipient name. The clean test comparison matched; value is redacted in fixtures. |
| `shipping.address` | `purchase_units[0].shipping.address.{address_line_1,address_line_2,admin_area_2,admin_area_1,postal_code,country_code}` | Normalize and bind returned address fields. The clean test comparison matched; values are redacted. |
| `shipping.optionId`, `shipping.type`, `shipping.amount` | Selected entry in `purchase_units[0].shipping.options[]` | Bind the selected option when returned. G0-02 GET omitted options; equality tolerates absent option ID/type and uses the amount breakdown's shipping value. |
| `items[]` | `purchase_units[0].items[].{name,sku,quantity,unit_amount,tax}` | Bind item name, variant SKU, quantity, currency/amount, and tax. Missing item tax normalizes to `0.00`. |
| Non-material response metadata | `id`, `status`, `payer`, `links`, timestamps, `custom_id`, and other non-binding fields | Excluded from the material CartBinding comparison. |

**G0-01 follow-up:** Sandbox buyer approval and capture succeeded on 2026-10-20. This is a positive observation for the exact tested flow only. PayPal GET omitted the create-time shipping preference; CartAttest retains the persisted requested value only for that omission, and rejects an explicitly conflicting returned value. G0-02 records the material comparison and focused tests verify the fallback rule. Do not imply PayPal returned the preference.

**G0-02 follow-up (2026-10-21):** Buyer approved fresh order `5H467160G6251084G`. The approved-side GET returned `APPROVED` and also omitted `shipping_preference`. A comparison of the approved material projection with the persisted create binding matched, allowing the persisted `SET_PROVIDED_ADDRESS` value only for the field PayPal omitted. Sanitized approved-side projection is recorded in `sanitized/g0-02-approved-projection.json`; no capture was performed for this comparison.

**G0-04 follow-up (2026-10-21):** On the G0-02 order after its approved-side projection was recorded, the amount was increased from GBP 25.50 to GBP 26.50 with a balanced breakdown. PayPal accepted the PATCH (204), but capture returned 422 `PAYER_ACTION_REQUIRED`; follow-up GET confirmed the order returned to `PAYER_ACTION_REQUIRED`. No capture completed during G0-04. The buyer approved the order again before the separate G0-05 amount-decrease observation.

**G0-05 follow-up (2026-10-21):** After the buyer approved the GBP 26.50 order, the total was reduced to GBP 24.50 with a balanced breakdown. PayPal accepted the PATCH (204); capture completed for GBP 24.50, and follow-up GET returned `COMPLETED`. PayPal did not require another buyer approval after this decrease in this exact flow. No additional claim is made about other account/order configurations.

**G0-06 follow-up (2026-10-22):** On a fresh approved order, the item was replaced with `Fictional Trail Shell` / `SHELL-RED-M` at the same unit price and quantity, preserving the GBP 25.50 total. PayPal accepted the PATCH (204), the GET showed the substituted item, and capture completed at GBP 25.50. This direct Gateway test did not exercise CartAttest's Binding comparison; the later live Gate 1 test confirmed the same class of item/SKU mismatch blocks before capture.

**G0-07 follow-up (2026-10-22):** On a fresh approved order, quantity changed from 1 to 2, unit price from GBP 20.00 to GBP 10.00, and per-item tax from GBP 2.00 to GBP 1.00, preserving GBP 25.50 total. PayPal accepted the PATCH (204), and capture completed at GBP 25.50. This direct provider test did not exercise CartAttest's Binding comparison. The live Gate 1 item/SKU test does not establish a live result for this separate quantity/unit-price mutation.

**G0-08 follow-up (2026-10-22):** On a fresh approved order, the shipping address was replaced with a different fictional test address. PayPal accepted the PATCH (204); follow-up GET confirmed the address differed from the persisted binding, and capture completed at GBP 25.50. The address itself is redacted. This direct provider test did not exercise CartAttest's Binding comparison. The live Gate 1 item/SKU test does not establish a live result for this separate address mutation.

**G0-10 intent follow-up (2026-10-22):** On the approved one-unit order, an attempt to change `intent` from `CAPTURE` to `AUTHORIZE` returned HTTP 422 `CANNOT_MODIFY_INTENT`. Follow-up GET showed the order remained `APPROVED` with intent `CAPTURE`. Payee mutation was not part of this earlier observation; see the 2026-10-24 follow-up below.

**G0-09 follow-up (2026-10-23):** After the Sandbox buyer approved a fresh GBP 25.50 order, `PATCH add /purchase_units/@reference_id=='default'` inserted a second purchase unit for GBP 1.00. PayPal returned HTTP 204; follow-up GET returned `APPROVED` with two units (GBP 1.00 and GBP 25.50). No capture was attempted. The earlier attempts targeted `/purchase_units/-`, `/purchase_units`, `/purchase_units/1`, and a nonexistent reference; they do not contradict this successful selector-based insertion. The local binding mapper rejects the resulting two-unit order; a separate live CartAttest multi-unit rejection case was not run.

**G0-11 follow-up (2026-10-22):** A second capture attempt on the completed G0-08 order returned HTTP 422 `ORDER_ALREADY_CAPTURED`; follow-up GET remained `COMPLETED`.

**G0-12 follow-up (2026-10-22):** PayPal accepted adding `custom_id` to the approved G0-09 order (HTTP 204); follow-up GET showed the value present. The binding mapper does not project this metadata, and an existing unit test asserts that changing `custom_id` does not change the material binding. No capture was attempted.

**G0-13 follow-up (2026-10-22):** A live Sandbox capture request was dispatched with a PayPal-Request-Id through a test wrapper that dropped the response after receiving HTTP 201. A fresh GET returned order and capture status `COMPLETED` at GBP 25.50; no retry was sent. The application service and existing unit test cover persisted unknown-attempt GET reconciliation and reuse of the stored request ID if the order is still `APPROVED`; that test was not run in this session.

**G0-10 payee follow-up (2026-10-24):** The buyer approved fresh order `5TE93938FU008544M`. The browser returned to CartAttest and displayed `ADMISSION_NOT_FOUND` because this direct Gate 0 order has no CartAttest admission; an independent PayPal GET confirmed status `APPROVED`. Replacing `/purchase_units/@reference_id=='default'/payee/email_address` with the second controlled Sandbox business account returned HTTP 204. Follow-up GET returned HTTP 200, `APPROVED`, intent `CAPTURE`, one purchase unit, and the target payee. No capture was attempted. The target email is redacted.

**G0-13 local follow-up (2026-10-24):** Ten focused `CompleteCheckoutService` and capture-state tests passed, covering completed/pending reconciliation, avoiding a retry after completion, and retry only after GET confirms `APPROVED` with reuse of the persisted PayPal request ID.
