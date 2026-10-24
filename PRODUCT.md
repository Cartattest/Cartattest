# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web application with a local Node.js HTTP server and browser-based buyer screens.

## Stack

Node.js 22, TypeScript, pnpm, PostgreSQL, PayPal Orders v2 REST, and browser Web Crypto for buyer signatures. The current server uses Node's `http` module; this repository does not use Next.js App Router.

## Users

The integrating customer is a developer, marketplace, or agent-commerce platform building PayPal-enabled shopping. The protected buyer reviews purchase constraints, approves payment at PayPal, and verifies the receipt. The STEP-UP screen exists, but model-backed semantic decisions are not enabled until Gate 2 is completed.

## Product Purpose

CartAttest prevents an AI shopping agent's interpretation of merchant evidence from silently becoming a payment action. It checks the selected cart against buyer-approved constraints and merchant evidence before creating a PayPal order, then checks the order binding again before capture.

## Positioning

CartAttest resolves cart facts and evidence independently, applies deterministic source-authority policy, and checks the PayPal order before and after buyer approval. The shopping agent may propose identifiers but cannot choose authoritative facts, evidence, payment operations, or buyer exceptions.

## Operating Context

The buyer approves a Claim Set. An agent proposes item and fulfillment identifiers. CartAttest resolves the item, evidence, price, and shipping. It blocks, asks for another item, or creates a PayPal order; once a semantic provider is enabled, it can also request a buyer decision for an eligible exact-subject exception. After PayPal approval, the server checks the binding and captures only if it still matches. A signed receipt records the result.

## Capabilities and Constraints

- Claim Sets are buyer-signed; the agent-facing selection API accepts identifiers only.
- Missing or stale required evidence fails closed as `UNPROVEN`. STEP-UP wording is generated from stored claim and evidence data, not authored by a model.
- Only `HUMAN_EXACT_SUBJECT` semantic claims may accept an exception. Integrity, provenance, merchant, budget, currency, quantity, SKU, and variant failures cannot be overridden.
- A signed override re-evaluates deterministic policy over the same frozen evidence and attestation; it does not rerun the attestor or fetch evidence again.
- PayPal orders are created only after `ALLOW`, then checked before redirect and immediately before capture.
- Gate 0 characterization is recorded in `fixtures/paypal/gate0-summary.md`; live Sandbox acceptance for Gates 1 and 3 is recorded in their respective summaries. These results apply only to the tested flows.
- Gate 2 is incomplete. Deterministic policy, evidence handling, signatures, STEP-UP, development pairs, and the report view exist, but the private evaluation holdout is not frozen and no semantic provider adapter is wired. The owner must decide the holdout and provider/model direction before model evaluation.
- The fixture merchant catalogue is in `fixtures/merchant/catalogue.json` and is for development; no real customer evidence, testimonials, or production brand assets are supplied.

## Product Principles

- Payment authority stays on the CartAttest server.
- Show the buyer the exact claim and its source evidence.
- Make the scope of an exception clear before the buyer signs it.
- Fail closed when evidence or transaction binding is incomplete.
- Distinguish tested observations from assumptions and fixtures.

## Accessibility & Inclusion

The buyer flow should support keyboard and screen-reader navigation, readable contrast, and reduced-motion preferences. No formal conformance target was supplied.
