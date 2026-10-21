import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scoreEvaluation, validateEvaluationDataset, validateEvaluationInputs } from "../scripts/evaluation-report.mjs";

const scenarios = [
  scenario("attack", "pair-1", "adversarial", "STEP_UP"),
  scenario("benign", "pair-1", "benign", "ALLOW")
];

test("development corpus has twenty matched pairs and two templates per attack family", async () => {
  const lines = (await readFile(new URL("../fixtures/evaluation/dev-scenarios.jsonl", import.meta.url), "utf8"))
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const inputs = (await readFile(new URL("../fixtures/evaluation/dev-inputs.jsonl", import.meta.url), "utf8"))
    .split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const result = validateEvaluationDataset(lines, { expectedPairs: 20, minTemplatesPerFamily: 2 });
  assert.equal(validateEvaluationInputs(lines, inputs).inputCount, 40);
  assert.equal(result.scenarioCount, 40);
  assert.equal(result.pairCount, 20);
  assert.equal(result.attackFamilies.length, 8);
});

test("evaluation scoring separates unsafe allows, unnecessary step-ups, and instability", () => {
  const runs = [];
  for (const scenario of scenarios) {
    for (let repetition = 1; repetition <= 2; repetition++) {
      runs.push(run(scenario.scenario_id, "C", repetition,
        scenario.kind === "adversarial"
          ? repetition === 2 ? "ALLOW" : "STEP_UP"
          : repetition === 1 ? "STEP_UP" : "ALLOW"));
      runs.at(-1).trace = "private model trace";
    }
  }

  const report = scoreEvaluation(scenarios, runs);
  const cartattest = report.conditions.C;
  assert.equal(cartattest.unsafeAllowRuns, 1);
  assert.equal(cartattest.unnecessaryStepUpRuns, 1);
  assert.equal(cartattest.scenariosWithUnsafeAllow, 1);
  assert.equal(cartattest.unstableScenarios, 2);
  assert.equal(cartattest.runCount, 4);
  assert.equal(cartattest.byAttackFamily.source_authority.unsafeAllowRuns, 1);
  assert.equal(JSON.stringify(report).includes("private model trace"), false);
});

test("evaluation scoring rejects missing or duplicate scenario runs", () => {
  assert.throws(() => scoreEvaluation(scenarios, [run("attack", "C", 1, "ALLOW")]), /RUN_MATRIX_INCOMPLETE/);
  assert.throws(() => scoreEvaluation(scenarios, [
    run("attack", "C", 1, "ALLOW"), run("attack", "C", 1, "ALLOW"),
    run("benign", "C", 1, "ALLOW")
  ]), /DUPLICATE_EVALUATION_RUN/);
});

test("evaluation model conditions must use the same frozen model configuration", () => {
  const runs = [];
  for (const scenario of scenarios) {
    for (const condition of ["A", "B"]) {
      runs.push({ ...run(scenario.scenario_id, condition, 1, scenario.expected_policy_outcome),
        model_id: condition === "A" ? "model-a" : "model-b" });
    }
  }
  assert.throws(() => scoreEvaluation(scenarios, runs), /MODEL_CONFIG_MISMATCH_ACROSS_CONDITIONS/);
});

test("deterministic reference reports pass only when it always fails closed", () => {
  const runs = scenarios.map((item) => ({
    ...run(item.scenario_id, "REFERENCE", 1, "STEP_UP"),
    provider: "deterministic",
    model_id: "fail-closed"
  }));
  assert.equal(scoreEvaluation(scenarios, runs).conformance.status, "PASS");
  runs[0].outcome = "ALLOW";
  assert.equal(scoreEvaluation(scenarios, runs).conformance.status, "FAIL");
});

function scenario(scenario_id, pair_id, kind, expected_policy_outcome) {
  return { scenario_id, pair_id, attack_family: "source_authority", kind, expected_policy_outcome };
}

function run(scenario_id, condition, repetition, outcome) {
  return {
    scenario_id,
    condition,
    repetition,
    outcome,
    latency_ms: repetition * 10,
    provider: "fixture-provider",
    model_id: "fixture-model"
  };
}
