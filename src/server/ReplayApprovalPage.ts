export function handleReplayApprovalPageRequest(request: Request): Response | undefined {
  if (new URL(request.url).pathname !== "/replay/approve") return undefined;
  if (request.method !== "GET") return html("<h1>Method not allowed</h1>", 405, { Allow: "GET" });
  const tokens = new URL(request.url).searchParams.getAll("token");
  if (tokens.length !== 1 || !/^REPLAY-ORDER-[1-9][0-9]*$/.test(tokens[0]!)) return html("<h1>Invalid replay approval link</h1>", 400);
  return html(page.replaceAll("__ORDER_ID__", encodeURIComponent(tokens[0]!)), 200);
}

function html(body: string, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", ...headers } });
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<title>Replay approval | CartAttest</title><style>
:root{color-scheme:light;--paper:#f5f1ea;--ink:#193c31;--muted:#50645b;--line:#c9d3c8;--green:#164b37;--white:#fffefa}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{max-width:980px;margin:auto;padding:24px 28px;border-bottom:1px solid var(--line)}main{width:min(100% - 32px,680px);margin:56px auto}article{background:var(--white);border:1px solid var(--line);border-radius:14px;padding:clamp(24px,5vw,48px)}.label{color:var(--muted);font:600 .72rem ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}h1{font:500 clamp(2rem,5vw,3rem)/1.08 Georgia,serif;letter-spacing:-.025em;margin:12px 0}p{color:var(--muted)}button{min-height:48px;border:0;border-radius:999px;padding:12px 24px;background:var(--green);color:white;font:650 1rem -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}button:focus-visible{outline:3px solid #b36332;outline-offset:3px}button:disabled{opacity:.6;cursor:wait}#status{min-height:1.5em}@media(max-width:560px){header{padding:18px 20px}main{margin:24px auto}}
</style></head><body><header>CartAttest <span aria-hidden="true">/</span> Local replay</header><main><article>
<p class="label">Simulated replay approval</p><h1>Approve this test order</h1><p>This local replay does not contact PayPal or move money. Approving it advances the saved test order so CartAttest can run its normal post-approval checks.</p>
<button id="approve" type="button">Approve replay order</button><p id="status" role="status" aria-live="polite"></p></article></main>
<script>const orderId="__ORDER_ID__",button=document.querySelector("#approve"),status=document.querySelector("#status");button.addEventListener("click",async()=>{button.disabled=true;status.textContent="Recording simulated approval…";try{const response=await fetch("/api/replay/orders/"+orderId+"/approve",{method:"POST"}),result=await response.json();if(!response.ok)throw Error(result.error||"Replay approval failed");location.assign("/checkout/return?token="+encodeURIComponent(orderId))}catch(error){status.textContent=error.message;button.disabled=false}});</script>
</body></html>`;
