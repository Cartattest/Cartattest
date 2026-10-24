export function handleStepUpPageRequest(request: Request): Response | undefined {
  const match = /^\/step-up\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (!match) return undefined;
  if (request.method !== "GET") return html("<h1>Method not allowed</h1>", 405, { Allow: "GET" });
  let sessionId: string;
  try { sessionId = decodeURIComponent(match[1]!); } catch { return html("<h1>Invalid review link</h1>", 400); }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return html("<h1>Invalid review link</h1>", 400);
  return html(page, 200);
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Review your purchase | CartAttest</title>
  <style>
    :root { color-scheme: light; --paper: #f5f1ea; --ink: #193c31; --muted: #50645b; --line: #c9d3c8; --green: #164b37; --white: #fffefa; --radius: 14px; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { max-width: 980px; margin: auto; padding: 24px 28px; border-bottom: 1px solid var(--line); font-weight: 650; letter-spacing: .01em; }
    main { width: min(100% - 32px, 760px); margin: 56px auto 80px; }
    article { background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); padding: clamp(24px, 5vw, 48px); }
    h1, h2 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; letter-spacing: -.025em; }
    h1 { font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1.08; margin: 0 0 12px; }
    h2 { font-size: clamp(1.55rem, 4vw, 2.15rem); line-height: 1.2; margin: 0 0 22px; }
    p { margin: 0; }
    .intro { max-width: 58ch; color: var(--muted); margin-bottom: 30px; }
    .label { color: var(--muted); font: 600 .72rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
    .product { display: flex; justify-content: space-between; gap: 24px; border-block: 1px solid var(--line); padding: 18px 0; margin-bottom: 30px; }
    .product strong { display: block; }
    .amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .claim { margin-bottom: 28px; }
    .evidence { list-style: none; margin: 0 0 30px; padding: 0; border-top: 1px solid var(--line); }
    .evidence li { display: grid; grid-template-columns: minmax(130px, .32fr) 1fr; gap: 18px; padding: 16px 0; border-bottom: 1px solid var(--line); }
    .source { color: var(--green); font: 600 .72rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
    .quote { color: var(--ink); }
    .actions { display: grid; gap: 12px; padding-top: 6px; }
    button { min-height: 48px; border: 1px solid var(--green); border-radius: 999px; padding: 12px 20px; background: var(--green); color: white; font: 650 1rem/1.2 -apple-system, BlinkMacSystemFont, sans-serif; cursor: pointer; transition: transform 140ms cubic-bezier(.23,1,.32,1), background-color 140ms ease-out; }
    button.secondary { color: var(--green); background: transparent; }
    button:hover { background: #0f3e2c; }
    button.secondary:hover { background: #edf2ec; }
    button:active { transform: scale(.98); }
    button:focus-visible, input:focus-visible { outline: 3px solid #b36332; outline-offset: 3px; }
    .scope { color: var(--muted); font-size: .9rem; }
    .key-field { display: grid; gap: 8px; margin: 8px 0; }
    input[type=file] { max-width: 100%; color: var(--ink); }
    .message { min-height: 1.5em; margin-top: 10px; color: var(--muted); }
    .error { color: #8d2f26; }
    blockquote { margin: 0; }
    @media (max-width: 560px) {
      header { padding: 18px 20px; }
      main { margin-top: 24px; }
      .product { display: grid; gap: 12px; }
      .amount { text-align: left; }
      .evidence li { grid-template-columns: 1fr; gap: 6px; }
    }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
  </style>
</head>
<body>
  <header>CartAttest <span aria-hidden="true">/</span> Purchase review</header>
  <main>
    <article aria-labelledby="page-title" aria-busy="true">
      <h1 id="page-title">Review this purchase</h1>
      <p class="intro">A product claim needs your attention. Review the merchant evidence before deciding what happens next.</p>
      <div id="review" aria-live="polite"><p>Loading the saved review…</p></div>
      <p id="message" class="message" role="status"></p>
    </article>
  </main>
  <script>
    const sessionId = decodeURIComponent(location.pathname.split("/").pop() || "");
    const review = document.querySelector("#review");
    const article = document.querySelector("article");
    const message = document.querySelector("#message");
    const node = (tag, text, className) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const send = async (body) => {
      const response = await fetch("/api/step-ups/" + encodeURIComponent(sessionId), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The decision could not be saved.");
      return result;
    };
    const bytesFromPem = (pem) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\\s/g, "")), c => c.charCodeAt(0));
    async function load() {
      try {
        const response = await fetch("/api/step-ups/" + encodeURIComponent(sessionId), { headers: { accept: "application/json" } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This review link is unavailable.");
        review.replaceChildren();
        const product = node("section", undefined, "product");
        const identity = node("div");
        identity.append(node("span", "Selected item", "label"));
        identity.append(node("strong", data.subject.name || data.subject.subjectRef));
        if (data.subject.sku) identity.append(node("span", "SKU " + data.subject.sku));
        product.append(identity);
        if (data.subject.total) {
          const amount = node("div", undefined, "amount");
          amount.append(node("span", "Cart total", "label"));
          amount.append(node("strong", data.subject.currency + " " + data.subject.total));
          product.append(amount);
        }
        review.append(product);
        const list = node("section", undefined, "claim");
        list.append(node("p", "Claim under review", "label"));
        data.claims.forEach((claim) => {
          list.append(node("h2", claim.text));
          if (claim.value !== undefined) list.append(node("p", "Requested: " + String(claim.value)));
          const evidence = node("ul", undefined, "evidence");
          (claim.evidence || []).forEach((item) => {
            const row = node("li");
            row.append(node("span", item.sourceClass + " · " + item.fieldLocator, "source"));
            row.append(node("blockquote", item.text, "quote"));
            evidence.append(row);
          });
          if (!claim.evidence?.length) evidence.append(node("li", "No usable merchant evidence was found."));
          list.append(evidence);
        });
        review.append(list);
        const actions = node("div", undefined, "actions");
        const choose = node("button", "Choose another item");
        choose.type = "button";
        choose.addEventListener("click", async () => {
          choose.disabled = true;
          message.textContent = "Saving your choice…";
          try {
            const result = await send({ decision: "CHOOSE_ANOTHER" });
            message.textContent = result.status === "CHOOSE_ANOTHER" ? "You can return to the shopping agent to choose another item." : "Decision saved.";
            actions.replaceChildren();
          } catch (error) { message.textContent = error.message; message.className = "message error"; choose.disabled = false; }
        });
        actions.append(choose);
        if (data.claims.length && data.claims.every(claim => claim.exceptionAllowed && claim.overrideSigningPayload && claim.buyerKeyId)) {
          const scope = node("p", "This signs an exception for the exact claim and item shown above. Your private key stays in this browser.", "scope");
          actions.append(scope);
          const keyLabel = node("label", "Buyer private signing key (PKCS#8 PEM)", "label key-field");
          const file = node("input");
          file.type = "file"; file.accept = ".pem,text/plain";
          keyLabel.append(file); actions.append(keyLabel);
          const accept = node("button", "Sign exact exception");
          accept.type = "button"; accept.className = "secondary";
          accept.addEventListener("click", async () => {
            if (!file.files?.[0]) { message.textContent = "Choose your buyer private key file."; message.className = "message error"; return; }
            accept.disabled = true;
            message.textContent = "Signing the exact exception…";
            try {
              const pem = await file.files[0].text();
              const key = await crypto.subtle.importKey("pkcs8", bytesFromPem(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
              const overrides = await Promise.all(data.claims.map(async claim => {
                const payload = JSON.parse(claim.overrideSigningPayload);
                const bytes = new TextEncoder().encode(claim.overrideSigningPayload);
                const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bytes));
                return { ...payload, buyerSignature: { alg: "ES256", keyId: claim.buyerKeyId, signatureB64: btoa(String.fromCharCode(...signature)) } };
              }));
              const result = await send({ decision: "ACCEPT_EXACT_EXCEPTION", overrides });
              message.textContent = result.status === "ALLOWED" ? "Exception accepted. Continuing to PayPal checkout." : result.status === "BLOCKED" ? "This exception cannot be accepted under the purchase rules." : "The purchase still needs review.";
              if (result.status === "ALLOWED" && result.approvalUrl) location.assign(result.approvalUrl);
              if (result.status === "ALLOWED") actions.replaceChildren();
            } catch (error) { message.textContent = error.message; message.className = "message error"; }
            finally { accept.disabled = false; }
          });
          actions.append(accept);
        }
        review.append(actions);
        article.setAttribute("aria-busy", "false");
      } catch (error) {
        review.replaceChildren(node("p", error.message, "error"));
        article.setAttribute("aria-busy", "false");
      }
    }
    load();
  </script>
</body>
</html>`;

function html(body: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extraHeaders
  } });
}
