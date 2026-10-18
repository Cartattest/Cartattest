# CartAttest

CartAttest helps developers building PayPal-enabled commerce agents prevent an agent's interpretation of merchant evidence from silently becoming a payment action.

This repository is an early implementation scaffold. The current code includes domain contracts and an initial server-side PayPal Orders v2 adapter. Commerce admission, CartBindingV1 mapping and hashing, evidence-bundle verification, persistence, the buyer UI, and the complete Gate 0 characterization are still in progress. Keep the repository private until the collaborators agree on foreground IP ownership and an open-source license.

## Requirements

- Node.js 22 or newer
- pnpm 10.29.3
- PayPal sandbox account and REST app credentials for the Gate 0 flow

## Setup

```sh
corepack enable
pnpm install
cp .env.example .env
```

Fill in only the sandbox credentials needed for your task. Keep `.env` local; it is ignored by Git. The implementation currently reads PayPal credentials from the process environment when running the Gate 0 runner.

## Commands

```sh
pnpm typecheck
pnpm build
pnpm gate0 -- create path/to/cart-binding.json
pnpm gate0 -- get PAYPAL_ORDER_ID
pnpm gate0 -- capture PAYPAL_ORDER_ID PERSISTED_REQUEST_ID
pnpm gate0 -- patch PAYPAL_ORDER_ID path/to/patch.json
```

The Gate 0 runner targets PayPal Sandbox only. It creates orders, returns the approval URL, reads order state, captures after approval, and applies JSON Patch operations for characterization. Review patch files carefully; they can mutate sandbox orders. Use the locally supplied `buildpack/spec/GATE0_PAYPAL_TEST_PLAN.md` to record characterization results. Do not save or publish unsanitized PayPal responses, payer data, or credentials.

## Project material

The ignored `buildpack/` directory contains the supplied handoff, specifications, schemas, and starter fixtures. It is intentionally excluded from version control per the project setup; preserve a local copy when cloning or transferring the project. The application source and package configuration live at the repository root.

## Security boundary

Shopping agents may propose identifiers only. They must not provide authoritative price or terms, evidence URLs, PayPal order IDs, payment operations, or buyer decisions. PayPal credentials and operations stay server-side.
