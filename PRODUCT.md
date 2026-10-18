# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router, as specified by the project's reference implementation stack.

## Users

The integrating customer is a developer, marketplace, or agent-commerce platform building PayPal-enabled shopping. The protected buyer reviews the purchase constraints, resolves any semantic STEP-UP, approves the payment at PayPal, and reads the receipt.

## Product Purpose

CartAttest prevents an AI shopping agent's interpretation of merchant evidence from silently becoming a payment action. Success means the selected cart is checked against buyer-approved constraints and authoritative merchant evidence before a PayPal order is created, then remains bound through capture.

## Positioning

CartAttest resolves authoritative cart facts and evidence independently, applies deterministic source-authority policy, and checks the PayPal order before and after buyer approval. The shopping agent can propose identifiers but cannot choose the authoritative facts, evidence, payment operation, or buyer exception.

## Operating Context

The buyer approves a Claim Set. An agent proposes item and fulfillment identifiers. CartAttest resolves the item, evidence, price, and shipping; it either blocks, asks the buyer to choose another item or accept an eligible exact-subject exception, or creates a PayPal order. PayPal approval is followed by a server-side binding check and capture. A final receipt should explain the outcome and evidence.

## Capabilities and Constraints

- Claim Sets are buyer-signed and the agent-facing API accepts identifiers only.
- Missing or stale required evidence fails closed. STEP-UP text is generated from stored claim and evidence data, never authored by the model.
- Only `HUMAN_EXACT_SUBJECT` semantic claims may accept an exception. Integrity, provenance, merchant, budget, currency, quantity, SKU, and variant failures cannot be overridden.
- A signed override re-evaluates deterministic policy over the same frozen evidence and attestation; it does not rerun the attestor or fetch evidence again.
- PayPal orders are created only after ALLOW and are checked before redirect and immediately before capture.
- PayPal Gate 0 observations are not recorded yet. The attestor provider/model and private holdout freeze are also open; do not fabricate observations or tune against holdout material.
- A fixture merchant catalogue is available at `fixtures/merchant/catalogue.json`. No real customer evidence, testimonials, or brand assets are supplied.

## Product Principles

- Payment authority stays on the CartAttest server.
- Show the buyer the exact claim and its source evidence.
- Make the scope of an exception clear before the buyer signs it.
- Fail closed when the evidence or transaction binding is incomplete.
- Distinguish tested observations from assumptions and fixtures.

## Accessibility & Inclusion

The buyer flow must work with keyboard and screen-reader navigation, preserve readable contrast, and respect reduced-motion preferences. No formal conformance target was supplied.
