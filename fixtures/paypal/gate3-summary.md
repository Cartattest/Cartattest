# Gate 3 — Evidence and replay

**Status:** LIVE SANDBOX ACCEPTANCE COMPLETE (2026-10-24). The real webhook, duplicate delivery, GET-first capture reconciliation, and signed receipt checks all passed.

## Successful checkout webhook

- Admission `54cb08eb-9005-491d-8083-814f10450e90`, order `7EG41407DG499003L`, capture `0RW61939P5628651H`.
- PayPal completion event `WH-7T0595332V2192812-1WH51756LB517560F` was delivered successfully.
- CartAttest recorded one verified event row and closed as `CLOSED_VERIFIED_WEBHOOK`.
- Signed receipt returned `verified: true`.

## GET-first reconciliation and duplicate delivery

- Admission `15b39f99-8dd3-4425-824c-7f1b219d562c`, order `9EC486051F3325259`, capture `8K829184K98276908`.
- The capture completed while webhook verification was temporarily disabled; a repeated checkout-return GET reconciled it to `CLOSED_RECONCILED`.
- PayPal completion event `WH-090056593T274653F-83T60762H0057891U` was subsequently signature-verified and stored. CartAttest contains exactly one row for this event.
- The PayPal dashboard's delivery-attempt history showed `DELIVERED` at 13:28:35 and 13:36:11 Europe/Dublin time. The event list's top-level status showed `Failure`, inconsistent with both delivered attempts; the detail history confirms successful delivery and duplicate delivery.
- The signed receipt returned `verified: true` and retained `CLOSED_RECONCILED`.

Sanitized machine-readable evidence: `sanitized/g3-live-webhook-reconciliation.json`. No webhook secrets, signatures, payer data, or addresses are retained.
