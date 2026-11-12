import canonicalize from "canonicalize";

/**
 * Hosted demo: the same shopping-agent run as `pnpm demo:agent`, started from a browser button.
 * The buyer key is a demo key held by the server so visitors can try the flow without a key file;
 * in production the buyer signs on their own device. The agent still only proposes identifiers,
 * and every proposal goes through the normal /api/selections route (Gemini check, policy, PayPal).
 */

export interface DemoCatalogue {
  products: Array<{ subjectRef: string; name: string; variants: Array<{ variantRef: string; unitAmount: string; currency: string; tax?: string }> }>;
  fulfillments: Array<{ fulfillmentRef: string; shipping?: { amount?: string } }>;
}

export interface HostedDemoOptions {
  /** Handles an API request exactly as the public server would (normally handleCheckoutApiRequest). */
  callApi(request: Request): Promise<Response>;
  buyerPrivateKey: CryptoKey;
  buyerKeyId: string;
  catalogue: DemoCatalogue;
  /** Runs allowed per client per window, and for all clients together per hour. */
  perClientLimit?: number;
  perClientWindowMs?: number;
  globalHourlyLimit?: number;
  now?: () => number;
  newId?: () => string;
}

export const DEMO_BUYER_REQUEST = "Buy me a waterproof jacket, size M, under GBP 100.";

export class FixedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number) {}

  take(key: string): boolean {
    const time = this.now();
    const current = this.windows.get(key);
    if (!current || time - current.start >= this.windowMs) {
      if (this.windows.size > 10_000) this.windows.clear();
      this.windows.set(key, { start: time, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

export function createHostedDemo(options: HostedDemoOptions) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const perClient = new FixedWindowLimiter(options.perClientLimit ?? 5, options.perClientWindowMs ?? 10 * 60_000, now);
  const global = new FixedWindowLimiter(options.globalHourlyLimit ?? 60, 60 * 60_000, now);
  let running = 0;

  async function api(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await options.callApi(new Request(new URL(path, "http://localhost"), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    }));
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`DEMO_API_${response.status}_${typeof value.error === "string" ? value.error : "FAILED"}`);
    return value;
  }

  async function run(): Promise<Record<string, unknown>> {
    const createdAt = new Date(now());
    const claimSet = {
      schemaVersion: "claim-set-v1",
      claimSetId: `demo-${newId()}`,
      buyerRequestText: DEMO_BUYER_REQUEST,
      claims: [
        { claimId: "budget", kind: "BUDGET_MAX", humanText: "Total price must be no more than GBP 100.",
          operator: "LTE", value: 100, currency: "GBP", overridePolicy: "NEVER" },
        { claimId: "waterproof", kind: "SEMANTIC_BOOLEAN", humanText: "The jacket must be waterproof, not just water-resistant.",
          operator: "SUPPORTED", value: true, evidenceProfileId: "waterproof-v1", overridePolicy: "HUMAN_EXACT_SUBJECT" }
      ],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString()
    };
    const payload = canonicalize(claimSet);
    if (payload === undefined) throw new Error("DEMO_CLAIM_SET_INVALID");
    const signature = new Uint8Array(await globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" },
      options.buyerPrivateKey, new TextEncoder().encode(payload)));
    const stored = await api("/api/claim-sets", { ...claimSet, buyerSignature: { alg: "ES256", keyId: options.buyerKeyId,
      signatureB64: Buffer.from(signature).toString("base64") } });
    if (stored.status !== "STORED") throw new Error("DEMO_CLAIM_SET_NOT_STORED");

    const fulfillment = options.catalogue.fulfillments[0];
    const fulfillmentRef = fulfillment?.fulfillmentRef;
    if (!fulfillmentRef) throw new Error("DEMO_CATALOGUE_INVALID");
    const proposals = [];
    for (const product of options.catalogue.products) {
      const variant = product.variants[0];
      if (!variant) continue;
      let result: Record<string, unknown>;
      try {
        result = await api("/api/selections", { claimSetId: claimSet.claimSetId, subjectRef: product.subjectRef,
          variantRef: variant.variantRef, quantity: 1, fulfillmentRef });
      } catch (error) {
        result = { status: "ERROR", reason: error instanceof Error ? error.message : "FAILED" };
      }
      proposals.push({
        itemName: product.name,
        price: `${variant.currency} ${displayTotal(variant.unitAmount, variant.tax, fulfillment?.shipping?.amount)}`,
        status: result.status,
        ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
        ...(typeof result.approvalUrl === "string" ? { approvalUrl: result.approvalUrl } : {}),
        ...(typeof result.decisionUrl === "string" ? { decisionUrl: result.decisionUrl } : {}),
        evidenceChecks: Array.isArray(result.evidenceChecks) ? result.evidenceChecks : []
      });
    }
    return { buyerRequestText: claimSet.buyerRequestText, claims: claimSet.claims.map((claim) => claim.humanText),
      claimSetId: claimSet.claimSetId, proposals };
  }

  return async function handleHostedDemoRequest(request: Request, clientKey: string): Promise<Response | undefined> {
    const path = new URL(request.url).pathname;
    if (path === "/demo") {
      if (request.method !== "GET" && request.method !== "HEAD") return text("Method not allowed", 405, { Allow: "GET, HEAD" });
      return new Response(demoPage, { status: 200, headers: {
        "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      } });
    }
    if (path !== "/api/demo/run") return undefined;
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
    if (running >= 2) return json({ error: "DEMO_BUSY", message: "Another demo run is in progress. Try again in a few seconds." }, 429);
    if (!perClient.take(clientKey)) {
      return json({ error: "DEMO_RATE_LIMITED", message: "You have run the demo several times in a row. Wait a few minutes, or use the Decision log to review earlier runs." }, 429);
    }
    if (!global.take("all")) return json({ error: "DEMO_RATE_LIMITED", message: "The demo has had a lot of runs this hour. Please try again later." }, 429);
    running += 1;
    try {
      return json(await run(), 200);
    } catch {
      return json({ error: "DEMO_RUN_FAILED", message: "The demo run failed. Please try again." }, 502);
    } finally {
      running -= 1;
    }
  };
}

/** Display only: item + tax + shipping. CartAttest resolves the authoritative total server-side. */
export function displayTotal(...amounts: Array<string | undefined>): string {
  let cents = 0;
  for (const amount of amounts) {
    if (amount === undefined) continue;
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(amount)) return "?";
    const [whole, fraction = ""] = amount.split(".");
    cents += Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function json(value: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}

function text(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
}

const demoPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<title>Run the shopping agent · CartAttest</title><style>
:root{--paper:#f5f1ea;--ink:#193c31;--muted:#50645b;--line:#c9d3c8;--green:#164b37;--white:#fffefa;--amber:#8a5a1c;--red:#9b2c2c;--focus:#b36332}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:inherit;text-underline-offset:4px}a:focus-visible,button:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
header,main{width:min(1040px,calc(100% - 32px));margin:auto}header{min-height:64px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
.brand{font-weight:700;text-decoration:none}.nav{display:flex;gap:18px;font-size:.92rem}main{padding:40px 0 72px}
h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.02em}h1{font-size:clamp(2.2rem,5vw,3.4rem);line-height:1.05;margin:0 0 14px}
.intro{max-width:62ch;color:var(--muted);margin:0 0 24px}.brief{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0 0 24px}
.box{background:var(--white);border:1px solid var(--line);border-radius:12px;padding:18px 20px}.box h2{font-size:1.15rem;margin:0 0 8px}.box ul{margin:0;padding-left:18px}.box p{margin:0}
.label{font:600 .72rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
button{min-height:50px;padding:12px 22px;border:1px solid var(--green);border-radius:999px;background:var(--green);color:var(--white);font:650 1rem/1 inherit;cursor:pointer}
button[disabled]{opacity:.6;cursor:progress}.status{margin:14px 0 0;color:var(--muted);min-height:1.5em}.status.error{color:var(--red)}
.results{display:grid;gap:16px;margin-top:26px}.card{background:var(--white);border:1px solid var(--line);border-radius:12px;padding:18px 20px}
.card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 16px}.card h3{margin:0;font-size:1.15rem}
.pill{display:inline-block;padding:3px 10px;border-radius:999px;font:700 .75rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;background:var(--muted)}
.pill.ALLOWED{background:var(--green)}.pill.STEP_UP{background:var(--amber)}.pill.BLOCKED,.pill.ERROR{background:var(--red)}
.check{margin:12px 0 0;padding:12px 14px;border-left:3px solid var(--line);background:#f8f6f1}.check p{margin:4px 0}.quote.no:before{content:"✗ ";color:var(--red)}.quote.yes:before{content:"✓ ";color:var(--green)}
.src{color:var(--muted);font-size:.82rem}.next{margin:12px 0 0}.next a{font-weight:650}.note{margin-top:28px;color:var(--muted);font-size:.9rem;max-width:70ch}
@media(max-width:700px){.brief{grid-template-columns:1fr}.nav{gap:12px;font-size:.85rem}}
</style></head><body>
<header><a class="brand" href="/">CartAttest</a><nav class="nav"><a href="/demo">Run the agent</a><a href="/decisions">Decision log</a></nav></header>
<main>
<h1>Run the shopping agent</h1>
<p class="intro">A buyer signs two requirements. A shopping agent then proposes three jackets from a demo merchant. For each one, Google Gemini reads the merchant's evidence and must quote it word for word, and CartAttest's rules decide whether a PayPal sandbox order may be created.</p>
<div class="brief"><div class="box"><span class="label">Buyer request (signed)</span><p>"${DEMO_BUYER_REQUEST}"</p></div>
<div class="box"><span class="label">Requirements</span><ul><li>Total price must be no more than GBP 100.</li><li>The jacket must be waterproof, not just water-resistant.</li></ul></div></div>
<button id="run" type="button">Run the shopping agent</button>
<p class="status" id="status" role="status" aria-live="polite">Takes about 20 seconds: Gemini checks each jacket in turn.</p>
<div class="results" id="results"></div>
<p class="note">This hosted demo uses the PayPal <strong>sandbox</strong> only: no real money moves. To approve the allowed jacket, log in on the PayPal page with a sandbox <em>personal</em> test account (see the project's testing instructions). The buyer key is a demo key held by this server so you can try the flow without a key file; in a real deployment the buyer signs on their own device. Every run appears in the <a href="/decisions">Decision log</a>.</p>
</main>
<script>
const button=document.getElementById("run"),statusEl=document.getElementById("status"),results=document.getElementById("results");
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el};
const label={ALLOWED:"ALLOW",STEP_UP:"STEP-UP",BLOCKED:"BLOCK",ERROR:"ERROR"};
button.addEventListener("click",async()=>{button.disabled=true;results.replaceChildren();statusEl.className="status";statusEl.textContent="The agent is proposing jackets and Gemini is checking the evidence…";
try{const response=await fetch("/api/demo/run",{method:"POST"});const data=await response.json();if(!response.ok)throw new Error(data.message||"The demo run failed.");
for(const p of data.proposals){const card=node("article",undefined,"card"),head=node("div",undefined,"card-head");head.append(node("h3",p.itemName+" · "+p.price));head.append(node("span",label[p.status]||p.status,"pill "+p.status));card.append(head);
for(const c of p.evidenceChecks||[]){const box=node("div",undefined,"check");box.append(node("p","AI evidence check ("+c.modelId+"): "+c.result,"label"));
for(const q of c.contradictionQuotes||[]){const line=node("p","“"+q.verbatim+"” ","quote no");line.append(node("span",q.sourceClass,"src"));box.append(line)}
for(const q of c.supportQuotes||[]){const line=node("p","“"+q.verbatim+"” ","quote yes");line.append(node("span",q.sourceClass,"src"));box.append(line)}card.append(box)}
if(!(p.evidenceChecks||[]).length&&p.status!=="BLOCKED")card.append(node("p","No AI evidence check recorded (unavailable or failed closed, so treated as unproven).","next"));
const next=node("p",undefined,"next");
if(p.status==="ALLOWED"&&p.approvalUrl){next.append("All requirements met, so a PayPal sandbox order was created. ");const a=node("a","Approve in PayPal sandbox →");a.href=p.approvalUrl;next.append(a)}
else if(p.status==="STEP_UP"&&p.decisionUrl){next.append("Evidence does not prove the requirement. No PayPal order was created. ");const a=node("a","Review as the buyer →");a.href=p.decisionUrl;next.append(a)}
else if(p.status==="BLOCKED")next.append("Blocked before PayPal"+(p.reason?": "+p.reason:"")+".");
else next.append("This proposal could not be checked"+(p.reason?" ("+p.reason+")":"")+". Nothing was sent to PayPal.");
card.append(next);results.append(card)}
statusEl.textContent="Done. Each decision is also in the Decision log."}
catch(error){statusEl.className="status error";statusEl.textContent=error.message}finally{button.disabled=false}});
</script></body></html>`;
