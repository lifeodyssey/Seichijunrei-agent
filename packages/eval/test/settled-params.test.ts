/**
 * E-2 (#1381): pairing a call's two records, and what happens when the second
 * one is missing.
 *
 * The SCORES are not decided here — `evaluator-parity.test.ts` compares them
 * against Python's own, including the two oracle scenarios where the runtime
 * settled a call into something other than what the model asked with. What is
 * decided here is the pairing the wire forces on this side: the frames say
 * which calls were made and the transcript read says what each ran with, and
 * nothing in either record names the other. Getting that wrong would score one
 * call's arguments against another call's params — a wrong number, not a
 * missing one.
 *
 * test-type: unit (literal frames and reads; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";

import type { GetSessionHistoryResponse } from "@animichi/contract/session-history-contract";

import { transcriptResultOf, type TranscriptResult, type TurnFrame } from "../src/turn-transcript.ts";
import { OfficialArgumentCorrectness } from "../src/evaluators/index.ts";
import { contextFor, oracleCase, type OracleCase } from "./evaluator-oracle.ts";
import { shapedCapture } from "./recorded-capture.ts";

const RUN_ID = "run-under-measurement";
const EARLIER_RUN_ID = "run-of-an-earlier-turn";

/** The frames one call leaves on the stream, arguments included. */
function callFrames(callId: string, toolName: string, input: Record<string, unknown>): TurnFrame[] {
  return [
    { type: "tool-input-start", toolCallId: callId, toolName },
    { type: "tool-input-available", toolCallId: callId, toolName, input },
    { type: "tool-output-available", toolCallId: callId, output: {} },
  ];
}

/** One settled step, as the transcript read publishes it. */
function publishedStep(toolName: string, params: string, overrides: { runId?: string; index?: number } = {}) {
  return {
    run_id: overrides.runId ?? RUN_ID,
    step_index: overrides.index ?? 0,
    tool_name: toolName,
    params,
  };
}

function historyOf(steps: GetSessionHistoryResponse["steps"]): GetSessionHistoryResponse {
  return {
    messages: [],
    revision: 1,
    next_offset: null,
    run: { run_id: RUN_ID, status: "succeeded", reason: null },
    steps,
  };
}

function shape(frames: TurnFrame[], steps: GetSessionHistoryResponse["steps"]): TranscriptResult {
  return transcriptResultOf({ frames, priorTrajectory: [], history: historyOf(steps), locale: "ja" });
}

/** What each call ran with, in call order — the pairing's whole answer. */
function paramsOf(result: TranscriptResult): readonly (Readonly<Record<string, unknown>> | null)[] {
  return result.trajectory.map((step) => step.params);
}

void test("a call carries the params the read published for it", () => {
  const frames = callFrames("c1", "search_bangumi", { bangumi_id: "12345" });
  const shaped = shape(frames, [publishedStep("search_bangumi", '{"bangumi_id": 12345}')]);
  assert.deepEqual(shaped.trajectory.map((step) => step.args), [{ bangumi_id: "12345" }]);
  assert.deepEqual(paramsOf(shaped), [{ bangumi_id: 12345 }]);
});

void test("a call the read published no step for has no second witness", () => {
  const shaped = shape(callFrames("c1", "search_bangumi", { bangumi_id: 1 }), []);
  assert.deepEqual(paramsOf(shaped), [null]);
});

void test("a step settled by an earlier run answers for none of this turn's calls", () => {
  const frames = callFrames("c1", "resolve_anime", { title: "ハルヒ" });
  const earlier = publishedStep("resolve_anime", '{"title": "ユーフォ"}', { runId: EARLIER_RUN_ID });
  assert.deepEqual(paramsOf(shape(frames, [earlier])), [null]);
});

void test("the k-th call to a tool takes the k-th step settled under that name", () => {
  const frames = [
    ...callFrames("c1", "web_search", { query: "a" }),
    ...callFrames("c2", "web_search", { query: "b" }),
  ];
  const shaped = shape(frames, [
    publishedStep("web_search", '{"query": "a"}'),
    publishedStep("web_search", '{"query": "b"}', { index: 1 }),
  ]);
  assert.deepEqual(paramsOf(shaped), [{ query: "a" }, { query: "b" }]);
});

void test("the steps are paired in settlement order, whatever order they arrive in", () => {
  const frames = [
    ...callFrames("c1", "web_search", { query: "a" }),
    ...callFrames("c2", "web_search", { query: "b" }),
  ];
  const shaped = shape(frames, [
    publishedStep("web_search", '{"query": "b"}', { index: 1 }),
    publishedStep("web_search", '{"query": "a"}'),
  ]);
  assert.deepEqual(paramsOf(shaped), [{ query: "a" }, { query: "b" }]);
});

void test("a call settled under a different tool name answers for nothing", () => {
  const frames = callFrames("c1", "search_nearby", { place: "西宮" });
  const shaped = shape(frames, [publishedStep("search_bangumi", '{"place": "西宮"}')]);
  assert.deepEqual(paramsOf(shaped), [null]);
});

void test("params text that is not a JSON object is no witness at all", () => {
  const frames = callFrames("c1", "web_search", { query: "a" });
  assert.deepEqual(paramsOf(shape(frames, [publishedStep("web_search", "not json")])), [null]);
  assert.deepEqual(paramsOf(shape(frames, [publishedStep("web_search", "[1, 2]")])), [null]);
});

/** A page from an edge older than this field, and what the Python route sends:
 * no second record was offered for any call on it. */
function shapeWithoutSteps(): TranscriptResult {
  const frames = callFrames("c1", "web_search", { query: "a" });
  const history = { messages: [], revision: 1, next_offset: null, run: null };
  return transcriptResultOf({ frames, priorTrajectory: [], history, locale: "ja" });
}

void test("a page that carries no steps key at all leaves every call unwitnessed", () => {
  assert.deepEqual(paramsOf(shapeWithoutSteps()), [null]);
  assert.equal(shapeWithoutSteps().paramsRecorded, false);
});

void test("a page that carries steps has offered its record, even when it is empty", () => {
  const frames = callFrames("c1", "web_search", { query: "a" });
  assert.equal(shape(frames, []).paramsRecorded, true);
});

/**
 * The not-computable answer. A read that offered no step record says nothing
 * about whether this turn's calls ran with what the model asked for, so the
 * metric emits NOTHING — the same `{}` as a turn with no successful call, and
 * the difference between "unmeasured" and "every call was wrong".
 */
void test("a turn whose read published no steps at all scores no metric at all", () => {
  const scored = new OfficialArgumentCorrectness().evaluate(contextOf(shapeWithoutSteps()));
  assert.deepEqual(scored, {});
});

void test("the recorded capture's calls carry the params its transcript read published", () => {
  const shaped = shapedCapture("search");
  assert.deepEqual(paramsOf(shaped), [
    { title: "ユーフォ" },
    { bangumi_id: 12345 },
    {},
  ]);
});

/**
 * The one answer Python has no case for: it always had `StepRecord.params`, so
 * an unwitnessed call could only arrive as an empty dict and pass vacuously
 * when the call had no arguments (`params_recorded`, #443). Here it is a 0.
 */
function withoutPublishedParams(caseId: string): OracleCase {
  const entry = oracleCase(caseId);
  const trajectory = entry.transcript.trajectory.map((step) => ({ ...step, params: null }));
  return { ...entry, transcript: { ...entry.transcript, trajectory } };
}

void test("a successful call the read never answered for scores zero, never one", () => {
  const unwitnessed = withoutPublishedParams("empty_arguments_still_score");
  const scored = new OfficialArgumentCorrectness().evaluate(contextFor(unwitnessed));
  assert.deepEqual(scored, { argument_correctness: 0 });
});

/** One shaped turn in the context `Dataset.evaluate` hands an evaluator — the
 * oracle's own builder, given a transcript this file shaped. */
function contextOf(transcript: TranscriptResult) {
  return contextFor({ ...oracleCase("empty_arguments_still_score"), transcript });
}
