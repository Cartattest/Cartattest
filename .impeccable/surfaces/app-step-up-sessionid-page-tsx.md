---
version: 1
slug: "app-step-up-sessionid-page-tsx"
primary_target: "app/step-up/[sessionId]/page.tsx"
related_targets: []
---

# STEP-UP buyer review

Scope: the hosted buyer decision screen at `/step-up/:sessionId`. Visitor mode: operate. Audience: the protected buyer reviewing an exception before checkout.

## Direction contract

THESIS: Make the exact claim and why it failed legible before the buyer chooses another item or signs one narrow exception. Refuse a generic receipt layout that hides which evidence supports which claim.

OWN-WORLD: Use the Consumer guarantee card direction: warm paper ground, deep green ink, serif claim title, compact sans-serif controls, and monospaced labels. Keep the evidence source label beside its quote and make the claim-to-evidence relationship the card's signature move.

STORY: The buyer sees the selected item and total, understands the failed claim from frozen merchant evidence, then chooses another item or accepts only the eligible exact-subject exception.

FIRST VIEWPORT: A quiet checkout header leads into one centered guarantee card. Its top row names the review and evidence status; product and total follow; the exact claim is the largest content; source-labeled evidence rows follow in authority order; actions sit below the evidence, with the exception scope directly under the acceptance action. On narrow screens, the card becomes a single column without horizontal scrolling.

FORM: Consumer guarantee and product warranty cards, Impeccable's grounded pick, position 1, seed key 87e3c4cc. Use the chosen `model-pick.html` sketch as the code-led composition reference.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Task contract

The page loads a server-generated STEP-UP projection and offers only the server-defined actions. Evidence and claim text are data-bound; the client does not author or paraphrase them. Accepting an exception requires a valid buyer signature and preserves every non-overridable constraint. Unresolved: trusted buyer key provisioning and the Next.js runtime dependency install, currently blocked by npm registry DNS.
