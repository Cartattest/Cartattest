import test from "node:test";
import assert from "node:assert/strict";
import { handleEvaluationPageRequest } from "../src/server/EvaluationPage.ts";
import { scoreEvaluation } from "../scripts/evaluation-report.mjs";

test("evaluation route serves the report screen and rejects other paths", async () => {
  assert.equal(await handleEvaluationPageRequest(new Request("http://localhost/other")), undefined);
  const response = await handleEvaluationPageRequest(new Request("http://localhost/evaluation"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const page = await response.text();
  assert.match(page, /Evaluation results/);
  assert.equal(page.includes("—"), false);
});

test("report endpoint returns only safe summary fields", async () => {
  const response = await handleEvaluationPageRequest(
    new Request("http://localhost/api/evaluation/report"),
    async () => ({ ...validReport(), secret: "private trace" })
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.conditions.C.unsafeAllowRuns, 1);
  assert.equal(body.secret, undefined);
  assert.equal(body.scenarioOutcomes, undefined);
});

test("missing, invalid, and non-GET report requests fail closed", async () => {
  const url = "http://localhost/api/evaluation/report";
  assert.equal((await handleEvaluationPageRequest(new Request(url))).status, 503);
  assert.equal((await handleEvaluationPageRequest(new Request(url), async () => ({}))).status, 500);
  assert.equal((await handleEvaluationPageRequest(new Request(url, { method: "POST" }), async () => validReport())).status, 405);
});

function validReport() {
  const scenarios = [
    { scenario_id: "attack", pair_id: "pair", attack_family: "source_authority", kind: "adversarial", expected_policy_outcome: "STEP_UP" },
    { scenario_id: "benign", pair_id: "pair", attack_family: "source_authority", kind: "benign", expected_policy_outcome: "ALLOW" }
  ];
  const runs = scenarios.flatMap((scenario) => ["C", "REFERENCE"].map((condition) => ({
    scenario_id: scenario.scenario_id,
    condition,
    repetition: 1,
    outcome: condition === "REFERENCE" ? "STEP_UP" : scenario.kind === "adversarial" ? "ALLOW" : "STEP_UP",
    latency_ms: 80,
    provider: condition === "C" ? "sample" : "deterministic",
    model_id: condition === "C" ? "sample-model" : "fail-closed"
  })));
  return { ...scoreEvaluation(scenarios, runs, "2026-10-21T00:00:00.000Z"), scenarioOutcomes: { private: "trace" } };
}
