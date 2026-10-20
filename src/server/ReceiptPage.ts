export function handleReceiptPageRequest(request: Request): Response | undefined {
  const match = /^\/receipt\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (!match) return undefined;
  if (request.method !== "GET") return html("<h1>Method not allowed</h1>", 405, { Allow: "GET" });
  let bundleId: string;
  try { bundleId = decodeURIComponent(match[1]!); } catch { return html("<h1>Invalid receipt link</h1>", 400); }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(bundleId)) return html("<h1>Invalid receipt link</h1>", 400);
  return html(page.replaceAll("__BUNDLE_ID__", encodeURIComponent(bundleId)), 200);
}

function html(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers } });
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Purchase receipt | CartAttest</title>
<style>
:root{color-scheme:light;--paper:#f5f1ea;--ink:#193c31;--muted:#50645b;--line:#c9d3c8;--green:#164b37;--white:#fffefa}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{max-width:980px;margin:auto;padding:24px 28px;border-bottom:1px solid var(--line);font-weight:650}main{width:min(100% - 32px,760px);margin:56px auto 80px}
article{background:var(--white);border:1px solid var(--line);border-radius:14px;padding:clamp(24px,5vw,48px)}h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.025em}h1{font-size:clamp(2rem,5vw,3.2rem);line-height:1.08;margin:0 0 12px}h2{font-size:1.45rem;margin:28px 0 12px}
p{margin:0}.intro,.muted{color:var(--muted)}.product{display:flex;justify-content:space-between;gap:24px;border-block:1px solid var(--line);padding:18px 0;margin:28px 0}.label{display:block;color:var(--muted);font:600 .72rem/1.5 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}.amount{text-align:right;font-variant-numeric:tabular-nums}.claim{padding:16px 0;border-bottom:1px solid var(--line)}.source{font:600 .72rem ui-monospace,monospace;color:var(--green)}blockquote{margin:6px 0 0}.status{display:inline-flex;align-items:center;gap:8px;color:var(--green);font-weight:650}.status:before{content:"";width:9px;height:9px;border-radius:50%;background:#31845a}.fine{margin-top:30px;color:var(--muted);font-size:.88rem;overflow-wrap:anywhere}@media(max-width:560px){header{padding:18px 20px}main{margin-top:24px}.product{display:grid}.amount{text-align:left}}
</style></head><body><header>CartAttest <span aria-hidden="true">/</span> Verified purchase record</header>
<main><article aria-busy="true"><p class="status" id="verified">Checking signed receipt…</p><h1 id="title">Purchase receipt</h1><p class="intro">This record is shown after verifying its signed evidence bundle against the configured CartAttest key.</p><section id="content" aria-live="polite"></section><p class="fine" id="footer"></p></article></main>
<script>
const content=document.querySelector("#content"),article=document.querySelector("article"),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
async function load(){try{const r=await fetch("/api/receipts/__BUNDLE_ID__",{headers:{accept:"application/json"}}),d=await r.json();if(!r.ok)throw Error(d.error||"Receipt unavailable");document.querySelector("#verified").textContent="Signed evidence verified";document.querySelector("#title").textContent=d.item.name||"Completed purchase";const product=node("section",undefined,"product"),left=node("div"),right=node("div","","amount");left.append(node("span","Purchased item","label"),node("strong",d.item.name||d.item.sku||"Item"));if(d.item.sku)left.append(node("p","SKU "+d.item.sku,"muted"));right.append(node("span","Total","label"),node("strong",(d.amount.currency||"")+" "+(d.amount.total||"")));product.append(left,right);content.append(product);content.append(node("h2","Your requirements"));for(const claim of d.claims){const section=node("section",undefined,"claim");section.append(node("p",claim.text));for(const item of claim.evidence||[]){section.append(node("p",item.sourceClass+" · "+item.locator,"source"),node("blockquote",item.text))}content.append(section)}content.append(node("h2","Payment"));content.append(node("p",d.capture.status||d.capture.state));document.querySelector("#footer").textContent="Bundle "+d.bundleId+" · sealed "+d.sealedAt+" · "+d.closureState;article.setAttribute("aria-busy","false")}catch(e){document.querySelector("#verified").textContent="Receipt unavailable";document.querySelector("#verified").className="muted";content.append(node("p",e.message));article.setAttribute("aria-busy","false")}}load();
</script></body></html>`;
