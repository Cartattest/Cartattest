---
version: 1
slug: "src-server-homepage-ts"
primary_target: "src/server/HomePage.ts"
related_targets: []
---

# Root demo hub

Scope: the local demo entry page at `/`. Visitor mode: operate. Audience: owners, reviewers, and demo operators.

## Direction contract

THESIS: Orient a reviewer to the live demo and its evidence path. Avoid a redirect that hides the product flow.

OWN-WORLD: Extend the buyer UI's warm paper, deep green, serif headings, compact sans-serif text, and restrained monospaced route labels. Use the same light theme and pill buttons for actions.

STORY: Explain that CartAttest checks buyer constraints and merchant evidence before a PayPal capture. Give visitors a working buyer-review entry and a stable evaluation link. Explain that STEP-UP and receipt views appear with generated IDs during a checkout.

FIRST VIEWPORT: Use a left-aligned introduction beside a compact, clearly ordered transaction diagram. Place the buyer-review action first and evaluation beside it. Below, show the named workflow stages and the contextual routes without inventing sample IDs.

FORM: Narrow user request for a route hub instead of a redirect. Code-led extension of the existing product UI; no concept seed or visual comp used.

FINISH: desktop and 390px mobile screenshots reviewed; mobile document width matches the viewport; detector returned no findings. No raster assets were introduced. This is a local extension of the established buyer UI language, so no global DESIGN.md change was made.

## Task contract

Keep `/` as a GET page and leave API routing untouched. Only link to routes that work without an identifier. Keep all copy factual, responsive, keyboard accessible, and usable with reduced motion. Do not present synthetic checkout state as live status.
