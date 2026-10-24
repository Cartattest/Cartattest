# Gate 1 — Governed PayPal checkout

**Status:** LIVE SANDBOX ACCEPTANCE COMPLETE (2026-10-24). Both the successful checkout/capture path and the pre-capture Binding B mismatch block were observed. These are observations for the exact tested Sandbox flow.

## Successful checkout and capture

- Admission: `54cb08eb-9005-491d-8083-814f10450e90`
- PayPal order: `7EG41407DG499003L`
- Amount: GBP 97.50
- PayPal capture: `0RW61939P5628651H`, status `COMPLETED`
- CartAttest closure: `CLOSED_VERIFIED_WEBHOOK`
- Signed receipt: `verified: true`
- Sanitized evidence: `sanitized/g1-successful-sandbox-checkout.json`

## Binding B mismatch blocks capture

A fresh CartAttest order was created for `StormGuard Demo Jacket` / `SGD-BLK-M`, GBP 97.50. Before buyer approval, PayPal accepted a same-total replacement with `StormGuard Demo Jacket Variant` / `SGD-ALT-M` (PATCH 204). The buyer approved the order. CartAttest's return response was `CART_BINDING_MISMATCH`.

Follow-up checks confirmed:

- PayPal GET returned `APPROVED`, one purchase unit, GBP 97.50, and the mutated SKU.
- PayPal reported zero captures.
- CartAttest marked the admission `ABORTED` and created zero capture attempts.
- The mutated order was not captured.

Sanitized evidence: `sanitized/g1-binding-b-mismatch.json`.

The buyer signed the Claim Set and approved both Sandbox orders. No payer details or addresses are included in these fixtures.
