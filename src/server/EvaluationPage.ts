const route = "/api/evaluation/report";

export async function handleEvaluationPageRequest(
  request: Request,
  loadReport?: () => Promise<unknown>
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (path === "/evaluation") {
    return request.method === "GET" ? html(page) : methodNotAllowed("GET");
  }
  if (path !== route) return undefined;
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!loadReport) return json({ error: "EVALUATION_REPORT_UNAVAILABLE" }, 503);
  try {
    return json(toPublicReport(await loadReport()), 200);
  } catch (error) {
    return json({ error: error instanceof Error && error.message === "EVALUATION_REPORT_INVALID"
      ? "EVALUATION_REPORT_INVALID" : "EVALUATION_REPORT_UNAVAILABLE" },
    error instanceof Error && error.message === "EVALUATION_REPORT_INVALID" ? 500 : 503);
  }
}

function toPublicReport(value: unknown): PublicReport {
  if (!record(value) || value.schemaVersion !== "evaluation-report-v1" ||
      typeof value.evaluatedAt !== "string" || !Number.isFinite(Date.parse(value.evaluatedAt)) ||
      !counter(value.scenarioCount) || !counter(value.pairCount) ||
      !record(value.conditions) || Object.keys(value.conditions).length === 0 ||
      !record(value.modelConfigByCondition) || !record(value.conformance) ||
      !["PASS", "FAIL", "NOT_RUN"].includes(String(value.conformance.status))) {
    throw new Error("EVALUATION_REPORT_INVALID");
  }

  const conditions: PublicReport["conditions"] = {};
  for (const [key, item] of Object.entries(value.conditions)) {
    if (!conditionNames.has(key) || !record(item) || !record(item.latencyMs) || !record(item.byAttackFamily) ||
        !["runCount", "incorrectRuns", "unsafeAllowRuns", "unnecessaryStepUpRuns", "errorRuns",
          "scenariosWithUnsafeAllow", "unstableScenarios"].every((field) => counter(item[field])) ||
        !finite(item.latencyMs.p50) || !finite(item.latencyMs.p95)) throw new Error("EVALUATION_REPORT_INVALID");
    const byAttackFamily: NonNullable<PublicReport["conditions"][string]>["byAttackFamily"] = {};
    for (const [family, metrics] of Object.entries(item.byAttackFamily)) {
      if (!familyPattern.test(family) || !record(metrics) ||
          !["runCount", "unsafeAllowRuns", "unnecessaryStepUpRuns", "errorRuns",
            "scenariosWithUnsafeAllow", "unstableScenarios"].every((field) => counter(metrics[field]))) {
        throw new Error("EVALUATION_REPORT_INVALID");
      }
      byAttackFamily[family] = {
        runCount: metrics.runCount as number,
        unsafeAllowRuns: metrics.unsafeAllowRuns as number,
        unnecessaryStepUpRuns: metrics.unnecessaryStepUpRuns as number,
        errorRuns: metrics.errorRuns as number,
        scenariosWithUnsafeAllow: metrics.scenariosWithUnsafeAllow as number,
        unstableScenarios: metrics.unstableScenarios as number
      };
    }
    const modelConfig = value.modelConfigByCondition[key];
    if (!record(modelConfig) || !shortText(modelConfig.provider) || !shortText(modelConfig.model_id)) {
      throw new Error("EVALUATION_REPORT_INVALID");
    }
    conditions[key] = {
      model: { provider: modelConfig.provider, modelId: modelConfig.model_id },
      runCount: item.runCount as number,
      incorrectRuns: item.incorrectRuns as number,
      unsafeAllowRuns: item.unsafeAllowRuns as number,
      unnecessaryStepUpRuns: item.unnecessaryStepUpRuns as number,
      errorRuns: item.errorRuns as number,
      scenariosWithUnsafeAllow: item.scenariosWithUnsafeAllow as number,
      unstableScenarios: item.unstableScenarios as number,
      latencyMs: { p50: item.latencyMs.p50 as number, p95: item.latencyMs.p95 as number },
      byAttackFamily
    };
  }
  return {
    schemaVersion: "evaluation-report-v1",
    evaluatedAt: value.evaluatedAt,
    scenarioCount: value.scenarioCount,
    pairCount: value.pairCount,
    conformance: { status: value.conformance.status as PublicReport["conformance"]["status"] },
    conditions
  };
}

type PublicReport = {
  schemaVersion: "evaluation-report-v1";
  evaluatedAt: string;
  scenarioCount: number;
  pairCount: number;
  conformance: { status: "PASS" | "FAIL" | "NOT_RUN" };
  conditions: Record<string, {
    model: { provider: string; modelId: string };
    runCount: number;
    incorrectRuns: number;
    unsafeAllowRuns: number;
    unnecessaryStepUpRuns: number;
    errorRuns: number;
    scenariosWithUnsafeAllow: number;
    unstableScenarios: number;
    latencyMs: { p50: number; p95: number };
    byAttackFamily: Record<string, {
      runCount: number;
      unsafeAllowRuns: number;
      unnecessaryStepUpRuns: number;
      errorRuns: number;
      scenariosWithUnsafeAllow: number;
      unstableScenarios: number;
    }>;
  }>;
};

const conditionNames = new Set(["A", "B", "C", "REFERENCE"]);
const familyPattern = /^[a-z_]{1,80}$/;

function record(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function counter(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function shortText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= 200; }

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  } });
}
function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", ...extraHeaders
  } });
}
function methodNotAllowed(allow: string): Response {
  return json({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: allow });
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Evaluation results | CartAttest</title>
<style>
:root{color-scheme:light;--paper:#f5f1ea;--ink:#193c31;--muted:#50645b;--line:#c9d3c8;--green:#164b37;--white:#fffefa;--warn:#8a4a20;--bad:#9b342c}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{max-width:1180px;margin:auto;padding:22px 28px;border-bottom:1px solid var(--line);font-weight:650}main{width:min(100% - 32px,1120px);margin:40px auto 72px}
h1,h2{font-family:Georgia,"Times New Roman",serif;font-weight:500;letter-spacing:-.025em}h1{font-size:clamp(2rem,4vw,3rem);line-height:1.08;margin:0 0 10px}h2{font-size:1.55rem;margin:32px 0 12px}
p{margin:0}.intro,.muted{color:var(--muted)}.intro{max-width:66ch}.status{display:flex;flex-wrap:wrap;gap:16px;margin:22px 0;padding:14px 0;border-block:1px solid var(--line)}.status strong{font-variant-numeric:tabular-nums}.state{font-weight:650;color:var(--green)}
.table-wrap{overflow-x:auto;margin-top:12px}table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}th,td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:.76rem;letter-spacing:.04em;font-weight:650}td:first-child{font-weight:650}.model{display:block;color:var(--muted);font-size:.82rem;font-weight:400;margin-top:3px}.risk{color:var(--bad);font-weight:700}.good{color:var(--green);font-weight:650}
details{border-bottom:1px solid var(--line)}summary{padding:14px 0;font-weight:650;cursor:pointer}summary:focus-visible{outline:3px solid #b36332;outline-offset:3px}.family-table{font-size:.9rem;margin-bottom:18px}.empty{margin-top:24px;padding:20px 0;border-block:1px solid var(--line)}code{font: .88em ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;background:#e9eee7;padding:2px 5px;border-radius:4px}.error{color:var(--bad)}
@media(max-width:680px){header{padding:18px 20px}main{margin-top:25px}.table-wrap{margin-inline:-8px;padding-inline:8px}table{min-width:720px}.status{gap:8px 20px}}
</style></head><body><header>CartAttest <span aria-hidden="true">/</span> Development evaluation</header>
<main><h1>Evaluation results</h1><p class="intro">Development-set results compare the same model across three evidence workflows. This screen contains no owner-held holdout data.</p>
<p id="status" class="status" role="status" aria-live="polite"><span class="state">Loading saved results…</span></p>
<section id="content" aria-busy="true" aria-live="polite"></section></main>
<script>
const status=document.querySelector("#status"),content=document.querySelector("#content");
const node=(tag,text,className)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item};
const conditions={A:"Agent self-check",B:"Independent attestor, untyped evidence",C:"CartAttest, source-typed evidence",REFERENCE:"Fail-closed reference"};
const count=(value)=>new Intl.NumberFormat().format(value);
async function load(){try{const response=await fetch("${route}",{headers:{accept:"application/json"}});const report=await response.json();if(!response.ok)throw Error(report.error||"EVALUATION_REPORT_UNAVAILABLE");render(report)}catch(error){status.replaceChildren(node("span",error.message==="EVALUATION_REPORT_UNAVAILABLE"?"No saved development report yet.":"The saved report could not be loaded.",error.message==="EVALUATION_REPORT_UNAVAILABLE"?"state":"error"));const guidance=node("p","Run the development evaluation command after choosing and freezing the model configuration.","muted");content.replaceChildren(guidance)}finally{content.setAttribute("aria-busy","false")}}
function render(report){status.replaceChildren(node("span",report.pairCount+" matched pairs · "+report.scenarioCount+" scenarios","state"),node("span","Deterministic reference: "+report.conformance.status));status.append(node("span","Recorded "+new Date(report.evaluatedAt).toLocaleString()));const modelTable=document.createElement("div");modelTable.className="table-wrap";const table=document.createElement("table");table.innerHTML="<thead><tr><th scope=\"col\">Condition</th><th scope=\"col\">Runs</th><th scope=\"col\">Unsafe ALLOWs</th><th scope=\"col\">Unneeded STEP-UPs</th><th scope=\"col\">Error runs</th><th scope=\"col\">Unstable scenarios</th><th scope=\"col\">Latency p50 / p95</th></tr></thead>";const body=document.createElement("tbody");for(const [key,title] of Object.entries(conditions)){const result=report.conditions[key];const row=document.createElement("tr");const heading=node("td",title);if(report.conditions[key])heading.append(node("span",report.conditions[key].model.provider+" · "+report.conditions[key].model.modelId,"model"));row.append(heading);if(!result){row.append(node("td","Not run"));for(let i=0;i<5;i++)row.append(node("td","Not available"));body.append(row);continue}row.append(node("td",count(result.runCount)),metricCell(result.unsafeAllowRuns,result.unsafeAllowRuns>0),node("td",count(result.unnecessaryStepUpRuns)),node("td",count(result.errorRuns)),node("td",count(result.unstableScenarios)),node("td",result.latencyMs.p50+" ms / "+result.latencyMs.p95+" ms"));body.append(row)}table.append(body);modelTable.append(table);content.append(node("h2","Condition results"),modelTable);for(const [key,title] of Object.entries(conditions)){const result=report.conditions[key];if(!result)continue;const disclosure=document.createElement("details");const summary=node("summary",title+" by attack family");disclosure.append(summary);const wrap=document.createElement("div");wrap.className="table-wrap";const familyTable=document.createElement("table");familyTable.className="family-table";familyTable.innerHTML="<thead><tr><th scope=\"col\">Attack family</th><th scope=\"col\">Unsafe ALLOWs</th><th scope=\"col\">Unneeded STEP-UPs</th><th scope=\"col\">Error runs</th><th scope=\"col\">Scenarios with unsafe ALLOW</th><th scope=\"col\">Unstable scenarios</th></tr></thead>";const familyBody=document.createElement("tbody");for(const [family,metrics] of Object.entries(result.byAttackFamily)){const row=document.createElement("tr");row.append(node("th",family.replaceAll("_"," ").replace(/^./,c=>c.toUpperCase()),""),metricCell(metrics.unsafeAllowRuns,metrics.unsafeAllowRuns>0),node("td",count(metrics.unnecessaryStepUpRuns)),node("td",count(metrics.errorRuns)),node("td",count(metrics.scenariosWithUnsafeAllow)),node("td",count(metrics.unstableScenarios)));familyBody.append(row)}familyTable.append(familyBody);wrap.append(familyTable);disclosure.append(wrap);content.append(disclosure)}content.setAttribute("aria-busy","false")}
function metricCell(value,isRisk){return node("td",count(value),isRisk?"risk":"good")}
load();
</script></body></html>`;
