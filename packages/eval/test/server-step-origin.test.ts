/**
 * #1462: `argument_correctness` scores the model's calls, not the runtime's.
 *
 * A deterministic bypass (`plan_selected`, `plan_multi`, a place pick's radius
 * `search_nearby`) opens with `input: {}` — no model produced arguments for it —
 * and settles with the request the visitor made. Its two witnesses therefore
 * disagree by construction, and the metric read 0.0 on every successful bypass
 * turn: `D3_multi_success_two`, `D3_multi_partial_success`,
 * `D3_place_selection_radius`, `K1_ja_001`, `K1_en_002`. Python never scored
 * those steps at all (`official_evaluators.py:77-81` filters `model_initiated`,
 * and its committed baseline carries no `argument_correctness` key for the
 * fifteen `K1`/`K3` cases); the frames now carry the same fact, so this side
 * filters the same way.
 *
 * The numbers stay `evaluator-parity.test.ts`' business — three oracle scenarios
 * pin them against Python's own. What is decided HERE is that the rule is
 * per-STEP, which the wire cannot demonstrate on its own: a bypass turn makes no
 * model call, so no real transcript carries both kinds at once. Python's does
 * (its `geocode` substep is server-initiated beside a model `search_nearby`), and
 * a rule that skipped the whole TURN would agree with the oracle and disagree
 * with Python the first time the wire published such a pair.
 *
 * test-type: unit (literal frames and reads; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { GetSessionHistoryResponse } from "@animichi/contract/session-history-contract";

import { OfficialArgumentCorrectness } from "../src/evaluators/index.ts";
import { deviationsOf } from "../src/gate-run/first-deviation.ts";
import { transcriptResultOf, type TranscriptResult, type TurnFrame } from "../src/turn-transcript.ts";
import { contextFor, oracleCase } from "./evaluator-oracle.ts";
import { makeAttributedTurn } from "./make-attributed-turn.ts";

const RUN_ID = "run-under-measurement";

/** One call's frames. `origin` absent is what a model call looks like. */
function callFrames(callId: string, toolName: string, opened: Record<string, unknown>): TurnFrame[] {
  return [
    { type: "tool-input-start", toolCallId: callId, toolName, ...opened },
    { type: "tool-input-available", toolCallId: callId, toolName, input: opened.input ?? {} },
    { type: "tool-output-available", toolCallId: callId, output: {} },
  ];
}

/** A step the RUNTIME opened, exactly as `serverStepOpened` publishes one. */
function bypassFrames(callId: string, toolName: string): TurnFrame[] {
  return callFrames(callId, toolName, { toolMetadata: { origin: "server" } });
}

function publishedStep(toolName: string, params: string, index = 0) {
  return { run_id: RUN_ID, step_index: index, tool_name: toolName, params };
}

function shape(frames: TurnFrame[], steps: GetSessionHistoryResponse["steps"]): TranscriptResult {
  const run = { run_id: RUN_ID, status: "succeeded" } as const;
  const history: GetSessionHistoryResponse = { messages: [], revision: 1, next_offset: null, run, steps };
  return transcriptResultOf({ frames, priorTrajectory: [], history, locale: "ja" });
}

/** The one metric under test, scored on a shaped turn. */
function scored(transcript: TranscriptResult): Record<string, number> {
  return new OfficialArgumentCorrectness().evaluate(
    contextFor({ ...oracleCase("empty_arguments_still_score"), transcript }),
  );
}

void test("the shaper reads each call's origin off the frame that opened it", () => {
  const shaped = shape(
    [...bypassFrames("c1", "plan_multi"), ...callFrames("c2", "web_search", { input: { query: "a" } })],
    [],
  );

  assert.deepEqual(shaped.trajectory.map((step) => [step.toolName, step.origin]), [
    ["plan_multi", "server"],
    ["web_search", "model"],
  ]);
});

void test("a bypass whose two witnesses disagree is not scored at all", () => {
  const shaped = shape(bypassFrames("c1", "plan_multi"), [
    publishedStep("plan_multi", '{"candidate_ids": ["c1", "c2"]}'),
  ]);

  assert.deepEqual(shaped.trajectory.map((step) => [step.args, step.params]), [
    [{}, { candidate_ids: ["c1", "c2"] }],
  ]);
  assert.deepEqual(scored(shaped), {});
});

void test("a model call whose two witnesses disagree still scores zero", () => {
  const frames = callFrames("c1", "search_bangumi", { input: { bangumi_id: "12345" } });
  const shaped = shape(frames, [publishedStep("search_bangumi", '{"bangumi_id": 12345}')]);

  assert.deepEqual(scored(shaped), { argument_correctness: 0 });
});

void test("a bypass beside a model call takes only the model call out of the score", () => {
  const frames = [
    ...bypassFrames("c1", "plan_multi"),
    ...callFrames("c2", "web_search", { input: { query: "a" } }),
  ];
  const shaped = shape(frames, [
    publishedStep("plan_multi", '{"candidate_ids": ["c1"]}'),
    publishedStep("web_search", '{"query": "a"}', 1),
  ]);

  assert.deepEqual(scored(shaped), { argument_correctness: 1 });
});

void test("a turn whose only successful call was the runtime's own scores nothing", () => {
  const shaped = shape(bypassFrames("c1", "plan_selected"), [
    publishedStep("plan_selected", '{"point_ids": ["p1"]}'),
  ]);

  assert.equal(shaped.paramsRecorded, true);
  assert.deepEqual(scored(shaped), {});
});

/**
 * E-4's failure attribution reads `argument_correctness`' own predicate
 * (`first-deviation.ts::misArguedSteps`), so it has to skip the same steps: a
 * bypass turn that did exactly what was asked would otherwise be blamed for
 * wrong arguments in every committed result file.
 */
void test("failure attribution does not blame a bypass step for its empty input", () => {
  const bypass = makeAttributedTurn({
    stages: ["plan_multi"],
    steps: [{ tool: "plan_multi", args: {}, params: { candidate_ids: ["c1"] }, origin: "server" }],
  });
  const asked = makeAttributedTurn({
    stages: ["plan_multi"],
    steps: [{ tool: "plan_multi", args: {}, params: { candidate_ids: ["c1"] } }],
  });

  assert.deepEqual(deviationsOf(bypass.inputs, bypass.metadata, bypass.output), []);
  assert.deepEqual(
    deviationsOf(asked.inputs, asked.metadata, asked.output).map((one) => one.category),
    ["wrong_arguments"],
  );
});
