export function handleHomePageRequest(request: Request): Response | undefined {
  if (new URL(request.url).pathname !== "/") return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return html("<h1>Method not allowed</h1>", 405, { Allow: "GET, HEAD" });
  return html(page, 200);
}

function html(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers } });
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<meta name="description" content="See how CartAttest checks buyer requirements before PayPal capture."><title>CartAttest demo</title><style>
:root{color-scheme:light;--paper:#f5f1ea;--ink:#193c31;--muted:#50645b;--line:#c9d3c8;--green:#164b37;--white:#fffefa;--focus:#b36332}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-underline-offset:4px;text-decoration-thickness:1px}a:hover{text-decoration-thickness:2px}a:focus-visible{outline:3px solid var(--focus);outline-offset:4px}::selection{background:#d6e3d8;color:var(--ink)}
.skip{position:absolute;left:16px;top:12px;z-index:1;transform:translateY(-160%);padding:10px 14px;background:var(--white);border:1px solid var(--line);border-radius:8px}.skip:focus{transform:translateY(0)}
header{width:min(1160px,calc(100% - 48px));min-height:72px;margin:auto;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{text-decoration:none;font-weight:700;letter-spacing:-.02em}.context{color:var(--muted);font-size:.88rem}
main{width:min(1160px,calc(100% - 48px));margin:clamp(40px,7vw,88px) auto 72px}.hero{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:clamp(32px,6vw,80px);align-items:center}.hero-copy{max-width:510px;min-width:0}h1,h2,h3,p{margin-top:0}h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.025em}h1{max-width:10ch;margin-bottom:20px;font-size:clamp(2.7rem,5.2vw,4.8rem);line-height:1.04} .intro{max-width:46ch;margin-bottom:28px;color:var(--muted);font-size:1.08rem;line-height:1.65}
.actions{display:flex;align-items:center;flex-wrap:wrap;gap:20px}.primary{display:inline-flex;min-height:50px;align-items:center;justify-content:center;padding:12px 20px;border:1px solid var(--green);border-radius:999px;background:var(--green);color:var(--white);font-weight:650;text-decoration:none;transition:transform 140ms cubic-bezier(.23,1,.32,1),background-color 140ms ease-out}.primary:hover{background:#103b2a}.primary:active{transform:scale(.98)}.secondary{font-weight:650}.helper{margin:16px 0 0;color:var(--muted);font-size:.88rem}
.flow-panel{min-width:0;padding:clamp(24px,4vw,42px);border:1px solid #2b604b;border-radius:14px;background:var(--green);color:var(--white)}.flow-panel h2{max-width:14ch;margin:0 0 26px;font-size:clamp(1.6rem,3vw,2.2rem);line-height:1.12}.flow-list{position:relative;display:grid;gap:20px;margin:0;padding:0;list-style:none}.flow-list:before{position:absolute;top:18px;bottom:18px;left:16px;width:1px;background:#71917e;content:""}.flow-step{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr);gap:16px;align-items:start}.flow-step>div{min-width:0}.step-number{display:grid;width:34px;height:34px;place-items:center;border:1px solid #9bb5a4;border-radius:50%;background:var(--green);font:600 .8rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}.flow-step h3{margin:2px 0 3px;font-size:1rem;line-height:1.35}.flow-step p{max-width:42ch;margin:0;color:#e1eae3;font-size:.9rem;line-height:1.5}.guard{margin:26px 0 0;padding-top:18px;border-top:1px solid #71917e;color:#e1eae3;font-size:.88rem}.guard strong{color:#fff}
.routes{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:clamp(52px,8vw,96px);padding-top:26px;border-top:1px solid var(--line)}.routes h2{margin:0;font-size:1.8rem}.route-copy{max-width:58ch;margin:2px 0 0;color:var(--muted)}.contextual{grid-column:2;display:flex;flex-wrap:wrap;gap:10px 22px;margin:0;padding:16px 0 0;border-top:1px solid var(--line);color:var(--muted);font-size:.86rem}.contextual span{white-space:nowrap}.contextual code{color:var(--ink);font:500 .82rem ui-monospace,SFMono-Regular,Menlo,monospace}
footer{width:min(1160px,calc(100% - 48px));margin:0 auto;padding:18px 0 28px;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
@media(max-width:820px){.hero{grid-template-columns:minmax(0,1fr);gap:36px}.hero-copy{max-width:620px}.routes{grid-template-columns:1fr;gap:14px}.contextual{grid-column:1}}
@media(max-width:560px){header,main,footer{width:min(1160px,calc(100% - 36px))}header{min-height:62px}.context{font-size:.78rem}main{margin:34px auto 52px}.hero{gap:28px}h1{max-width:16ch;font-size:clamp(2.45rem,10vw,2.8rem)}.intro{font-size:1rem}.actions{gap:16px}.flow-panel{padding:24px 20px}.flow-list{gap:18px}.flow-step{gap:12px}.routes{margin-top:52px}.contextual span{white-space:normal}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.primary{transition:none}}
</style></head><body><a class="skip" href="#main">Skip to content</a>
<header><a class="brand" href="/" aria-label="CartAttest home">CartAttest</a><span class="context">PayPal checkout demo</span></header>
<main id="main"><section class="hero" aria-labelledby="page-title"><div class="hero-copy">
<h1 id="page-title">Payment follows the buyer’s rules.</h1>
<p class="intro">CartAttest checks buyer requirements and merchant evidence before a PayPal order can be captured.</p>
<div class="actions"><a class="primary" href="/claim-set/review">Review buyer requirements</a><a class="secondary" href="/evaluation">View evaluation</a></div>
<p class="helper">Bring a Claim Set proposal and the local buyer signing key (.pem). The key stays in this browser.</p>
</div><aside class="flow-panel" aria-labelledby="flow-title"><h2 id="flow-title">Checks before capture</h2>
<ol class="flow-list">
<li class="flow-step"><span class="step-number" aria-hidden="true">1</span><div><h3>Buyer reviews and signs requirements</h3><p>The Claim Set records what the purchase must satisfy.</p></div></li>
<li class="flow-step"><span class="step-number" aria-hidden="true">2</span><div><h3>CartAttest checks the selection</h3><p>It resolves merchant facts and evidence, then checks the PayPal order before approval.</p></div></li>
<li class="flow-step"><span class="step-number" aria-hidden="true">3</span><div><h3>Buyer approves at PayPal</h3><p>The order is checked again after approval.</p></div></li>
<li class="flow-step"><span class="step-number" aria-hidden="true">4</span><div><h3>Binding B must match</h3><p>A changed cart stops before capture. A matching order can proceed to the signed receipt.</p></div></li>
</ol><p class="guard"><strong>Payment control stays server-side.</strong> The shopping agent proposes identifiers; it does not choose the authoritative cart or PayPal action.</p>
</aside></section>
<section class="routes" aria-labelledby="routes-title"><h2 id="routes-title">Other pages in the demo</h2><p class="route-copy">Evaluation opens directly. STEP-UP and receipt pages use identifiers created during a checkout, so they open from that flow.</p>
<div class="contextual"><span><code>/step-up/{sessionId}</code> Buyer reviews an eligible exception</span><span><code>/receipt/{bundleId}</code> Buyer verifies the completed purchase</span></div>
</section></main><footer>CartAttest checks the purchase before PayPal capture and records how the decision was reached.</footer></body></html>`;
