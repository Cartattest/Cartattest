import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// AG Grid Community is served from the installed package, so the page works offline and needs no CDN.
const gridAssetPath = "/assets/ag-grid-community.min.js";
let gridScript: Promise<Buffer> | undefined;

function loadGridScript(): Promise<Buffer> {
  if (!gridScript) {
    const main = createRequire(import.meta.url).resolve("ag-grid-community");
    gridScript = readFile(join(dirname(main), "..", "ag-grid-community.min.js"));
    gridScript.catch(() => { gridScript = undefined; });
  }
  return gridScript;
}

export async function handleDecisionLogPageRequest(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (path !== "/decisions" && path !== gridAssetPath) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (path === gridAssetPath) {
    try {
      return new Response(new Uint8Array(await loadGridScript()), { status: 200, headers: {
        "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff"
      } });
    } catch {
      return new Response("AG Grid is not installed. Run pnpm install.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  }
  return new Response(page, { status: 200, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  } });
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<title>CartAttest decision log</title><style>
:root{color-scheme:light;--paper:#f5f1ea;--ink:#193c31;--muted:#50645b;--line:#c9d3c8;--green:#164b37;--white:#fffefa;--allow:#1f6b4a;--step:#9a5b12;--block:#a3322a;--neutral:#5d6a64}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header,main{width:min(1480px,calc(100% - 32px));margin:auto}header{min-height:64px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
header a{color:inherit;font-weight:700;text-decoration:none}.crumb{color:var(--muted);font-size:.85rem}
h1{font:400 clamp(1.9rem,3.4vw,2.8rem)/1.1 Georgia,"Times New Roman",serif;margin:30px 0 8px;letter-spacing:-.01em}
.intro{max-width:72ch;color:var(--muted);margin:0 0 22px}
.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px}
.stat{background:var(--white);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.stat b{display:block;font-size:1.6rem;font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font:600 .7rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.07em;text-transform:uppercase}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
.toolbar input{flex:1 1 260px;min-height:40px;border:1px solid var(--line);border-radius:999px;padding:8px 16px;background:var(--white);font:inherit;color:inherit}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden;background:var(--white)}
.seg button,.btn{min-height:40px;border:0;background:transparent;padding:8px 14px;font:600 .85rem/1 inherit;color:var(--ink);cursor:pointer}
.seg button[aria-pressed=true]{background:var(--green);color:var(--white)}
.btn{border:1px solid var(--green);border-radius:999px;color:var(--green);background:transparent}
#grid{height:560px;width:100%}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font:700 .72rem/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;color:#fff}
.pill.ALLOW{background:var(--allow)}.pill.STEP_UP{background:var(--step)}.pill.BLOCK{background:var(--block)}.pill.CHOOSE_ANOTHER{background:var(--neutral)}
.sub{display:block;color:var(--muted);font-size:.78rem;line-height:1.3;margin-top:4px;overflow-wrap:anywhere}
.q{display:block;line-height:1.35;margin:2px 0}.q.con::before{content:"\\2717  ";color:var(--block);font-weight:700}.q.sup::before{content:"\\2713  ";color:var(--allow);font-weight:700}
.q small{color:var(--muted)}
#detail{margin:16px 0 48px;background:var(--white);border:1px solid var(--line);border-radius:12px;padding:16px 18px;display:none}
#detail h2{font-size:1rem;margin:0 0 6px}#detail p{margin:4px 0}#detail .k{color:var(--muted);font:600 .72rem/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.06em}
.status{color:var(--muted);font-size:.85rem;margin:8px 0}
@media(max-width:760px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}#grid{height:480px}}
</style></head><body>
<header><a href="/">CartAttest</a><span class="crumb">Decision log</span></header>
<main>
<h1>Every agent purchase decision</h1>
<p class="intro">Each row is one decision CartAttest made on a shopping agent's proposal, with the AI evidence check and its word-for-word quotes, the policy outcome, and the live PayPal order and payment status. Blocked and stepped-up proposals never reach PayPal.</p>
<section class="stats" aria-label="Summary">
<div class="stat"><b id="s-total">0</b><span>Decisions</span></div>
<div class="stat"><b id="s-allow">0</b><span>Allowed</span></div>
<div class="stat"><b id="s-step">0</b><span>Step-up</span></div>
<div class="stat"><b id="s-block">0</b><span>Blocked</span></div>
<div class="stat"><b id="s-paid">0</b><span>Payments completed</span></div>
</section>
<div class="toolbar">
<input id="search" type="search" placeholder="Search items, quotes, reasons, PayPal order IDs" aria-label="Search decisions">
<div class="seg" role="group" aria-label="Filter by decision">
<button type="button" data-outcome="" aria-pressed="true">All</button><button type="button" data-outcome="ALLOW" aria-pressed="false">Allowed</button>
<button type="button" data-outcome="STEP_UP" aria-pressed="false">Step-up</button><button type="button" data-outcome="BLOCK" aria-pressed="false">Blocked</button></div>
<button type="button" class="btn" id="refresh">Refresh</button><button type="button" class="btn" id="csv">Export CSV</button>
</div>
<div id="grid"></div>
<p class="status" id="status" role="status">Loading decisions…</p>
<section id="detail" aria-live="polite"></section>
</main>
<script src="${gridAssetPath}"></script>
<script>
(() => {
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const checksOf = (d) => Array.isArray(d.summary && d.summary.evidenceChecks) ? d.summary.evidenceChecks : [];
  const payment = (d) => d.captureStatus || d.captureState || d.admissionState || (d.outcome === "ALLOW" ? "ORDER_CREATED" : "NO_PAYPAL_ORDER");
  const quoteText = (d) => checksOf(d).flatMap((c) => [
    ...(c.contradictionQuotes || []).map((q) => "contradicts: \\u201c" + q.verbatim + "\\u201d (" + q.sourceClass + ")"),
    ...(c.supportQuotes || []).map((q) => "supports: \\u201c" + q.verbatim + "\\u201d (" + q.sourceClass + ")")]).join(" | ");
  const reasonText = (d) => {
    const failed = Array.isArray(d.summary.failedRules) ? d.summary.failedRules : [];
    if (d.outcome === "BLOCK") return failed.length ? "Rule failed: " + failed.join("; ") : "Blocked: " + String(d.reason || "").replaceAll("_", " ").toLowerCase();
    if (d.outcome === "STEP_UP") return "Not proven, buyer must review: " + String(d.reason || "").replaceAll(",", ", ");
    if (d.reason === "BUYER_SIGNED_EXCEPTION") return "Buyer signed an exception for this exact item";
    if (d.reason === "BUYER_CHOSE_ANOTHER") return "Buyer chose another item";
    return d.outcome === "ALLOW" ? "All requirements met" : (d.reason || "\\u2014");
  };
  let outcomeFilter = "";
  const columnDefs = [
    { headerName: "Time", field: "createdAt", sort: "desc", width: 140,
      valueFormatter: (p) => new Date(p.value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) },
    { headerName: "Decision", field: "outcome", width: 150, autoHeight: true, cellRenderer: (p) => { const w = el("div");
      w.append(el("span", p.value === "STEP_UP" ? "STEP-UP" : p.value.replace("_", " "), "pill " + p.value));
      w.append(el("span", p.data.source === "STEP_UP_DECISION" ? "buyer decision" : "agent proposal", "sub")); return w; } },
    { headerName: "Item", width: 180, valueGetter: (p) => (p.data.summary.itemName || p.data.subjectRef || "\\u2014"),
      cellRenderer: (p) => { const w = el("div"); w.append(el("span", p.value)); if (p.data.summary.sku) w.append(el("span", "SKU " + p.data.summary.sku, "sub")); return w; }, autoHeight: true },
    { headerName: "Total", width: 105, type: "rightAligned", valueGetter: (p) => p.data.summary.total ? Number(p.data.summary.total) : null,
      valueFormatter: (p) => p.value == null ? "\\u2014" : (p.data.summary.currency || "") + " " + Number(p.value).toFixed(2) },
    { headerName: "AI verdict", width: 150, valueGetter: (p) => checksOf(p.data).map((c) => c.result).join(", ") || "none",
      cellRenderer: (p) => { const w = el("div"); w.append(el("span", p.value)); const m = checksOf(p.data)[0]; if (m) w.append(el("span", m.modelId, "sub")); return w; }, autoHeight: true },
    { headerName: "Evidence quotes", flex: 1, minWidth: 240, wrapText: true, autoHeight: true, valueGetter: (p) => quoteText(p.data),
      cellRenderer: (p) => { const w = el("div"); for (const c of checksOf(p.data)) {
        for (const q of c.contradictionQuotes || []) { const s = el("span", "\\u201c" + q.verbatim + "\\u201d ", "q con"); s.append(el("small", q.sourceClass)); w.append(s); }
        for (const q of c.supportQuotes || []) { const s = el("span", "\\u201c" + q.verbatim + "\\u201d ", "q sup"); s.append(el("small", q.sourceClass)); w.append(s); } }
        if (!w.childNodes.length) w.append(el("span", "\\u2014", "sub")); return w; } },
    { headerName: "Why", width: 165, wrapText: true, autoHeight: true, valueGetter: (p) => reasonText(p.data) },
    { headerName: "PayPal", width: 165, autoHeight: true, valueGetter: (p) => payment(p.data).replaceAll("_", " ") + (p.data.paypalOrderId ? " " + p.data.paypalOrderId : ""),
      cellRenderer: (p) => { const w = el("div"); w.append(el("span", payment(p.data).replaceAll("_", " "))); if (p.data.paypalOrderId) w.append(el("span", p.data.paypalOrderId, "sub")); return w; } },
    { headerName: "Record", width: 95, sortable: false, filter: false, valueGetter: (p) => p.data.receiptAvailable ? "Receipt" : (p.data.outcome === "STEP_UP" && p.data.stepUpSessionId ? "Review" : ""),
      cellRenderer: (p) => { if (!p.value) return el("span", "\\u2014", "sub"); const a = el("a", p.value);
        a.href = p.value === "Receipt" ? "/receipt/" + encodeURIComponent(p.data.admissionId) : "/step-up/" + encodeURIComponent(p.data.stepUpSessionId); return a; } }
  ];
  const theme = agGrid.themeQuartz.withParams({ accentColor: "#164b37", backgroundColor: "#fffefa", foregroundColor: "#193c31",
    headerBackgroundColor: "#efe9df", borderColor: "#c9d3c8", wrapperBorderRadius: 12, fontSize: 14,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" });
  const api = agGrid.createGrid(document.getElementById("grid"), {
    theme, columnDefs, rowData: [], pagination: true, paginationPageSize: 25, paginationPageSizeSelector: [25, 50, 100],
    defaultColDef: { sortable: true, filter: true, resizable: true, wrapText: true, autoHeight: true, cellStyle: { lineHeight: "1.4", paddingTop: "10px", paddingBottom: "10px" } }, getRowId: (p) => p.data.decisionId,
    isExternalFilterPresent: () => outcomeFilter !== "", doesExternalFilterPass: (n) => n.data.outcome === outcomeFilter,
    onRowClicked: (e) => showDetail(e.data), overlayNoRowsTemplate: "<span>No decisions yet. Run pnpm demo:agent.</span>"
  });
  function showDetail(d) {
    const box = document.getElementById("detail"); box.replaceChildren(); box.style.display = "block";
    box.append(el("h2", (d.summary.itemName || d.subjectRef || "Decision") + " \\u2014 " + d.outcome));
    const row = (k, v) => { const p = el("p"); p.append(el("span", k + "  ", "k"), el("span", v)); box.append(p); };
    if (d.summary.requestText) row("Buyer asked", d.summary.requestText);
    row("Decision ID", d.decisionId); if (d.claimSetId) row("Claim set", d.claimSetId); if (d.admissionId) row("Admission", d.admissionId);
    if (d.paypalOrderId) row("PayPal order", d.paypalOrderId); row("Payment", payment(d).replaceAll("_", " ")); row("Why", reasonText(d));
    for (const c of checksOf(d)) row("AI check (" + c.modelId + ")", c.result + (quoteText({ summary: { evidenceChecks: [c] } }) ? " \\u2014 " + quoteText({ summary: { evidenceChecks: [c] } }) : ""));
  }
  function stats(rows) {
    const count = (f) => rows.filter(f).length;
    document.getElementById("s-total").textContent = rows.length;
    document.getElementById("s-allow").textContent = count((d) => d.outcome === "ALLOW");
    document.getElementById("s-step").textContent = count((d) => d.outcome === "STEP_UP");
    document.getElementById("s-block").textContent = count((d) => d.outcome === "BLOCK");
    document.getElementById("s-paid").textContent = count((d) => d.captureStatus === "COMPLETED");
  }
  async function load() {
    const status = document.getElementById("status");
    try {
      const response = await fetch("/api/decisions", { headers: { accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "DECISION_LOG_UNAVAILABLE");
      api.setGridOption("rowData", body.decisions); stats(body.decisions);
      status.textContent = body.decisions.length + " decisions \\u00b7 updated " + new Date().toLocaleTimeString() + " \\u00b7 click a row for details";
    } catch (error) { status.textContent = "Could not load decisions (" + error.message + "). Has pnpm migrate been run?"; }
  }
  document.getElementById("search").addEventListener("input", (e) => api.setGridOption("quickFilterText", e.target.value));
  for (const b of document.querySelectorAll(".seg button")) b.addEventListener("click", () => {
    outcomeFilter = b.dataset.outcome; for (const o of document.querySelectorAll(".seg button")) o.setAttribute("aria-pressed", String(o === b)); api.onFilterChanged(); });
  document.getElementById("refresh").addEventListener("click", load);
  document.getElementById("csv").addEventListener("click", () => api.exportDataAsCsv({ fileName: "cartattest-decisions.csv" }));
  load();
})();
</script></body></html>`;
