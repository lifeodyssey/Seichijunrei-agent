/**
 * The shaper against the recorded Python captures (W3-2 #1300).
 *
 * The expectation is NOT written here. `apps/agent/tests/fixtures/chat_stream/`
 * carries, beside each `.sse`, an `<name>.agent-result.json` that the Python
 * recorder builds from the same turn with the eval evaluators' OWN accessors —
 * so what this suite compares is the wire-derived result against Python's
 * `AgentResult` as those evaluators read it, not against a second opinion typed
 * by the same hand that wrote the shaper.
 *
 * WHAT THE CAPTURES ARE AND ARE NOT. Their FRAME GRAMMAR is the deployed edge's
 * — #1283 built `turn-frames.ts` off these files and matched them frame for
 * frame — so everything the trajectory is read from is current. Their answer
 * ENVELOPE is not: `record_fixtures.py` records that re-running it today empties
 * the search capture's `data`, because `agent_result_to_response` now projects
 * the payload from the session registry rather than from the mapping handed to
 * `make_result`. `dataKeysOf` is therefore pinned against BOTH shapes — the
 * recorded one here, and today's `{results, itinerary}` pairing in "the intent
 * decides which keys are reported" below. Neither is a live staging turn;
 * `scripts/record-captures.sh` is what makes one.
 *
 * test-type: unit (checked-in files; no network, no clock).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { dataKeysOf } from "../src/turn-transcript.ts";
import {
  answeredCaptureNames,
  pythonEvaluatorView,
  recordedCall,
  shapedCapture,
} from "./recorded-capture.ts";

for (const name of answeredCaptureNames()) {
  const shaped = shapedCapture(name);
  const python = pythonEvaluatorView(name);

  void test(`${name}: the trajectory is Python's, in call order and with its arguments`, () => {
    assert.deepEqual(shaped.trajectory.map(recordedCall), python.trajectory);
  });

  void test(`${name}: the tool names alone match \`_actual_tools\``, () => {
    assert.deepEqual(
      shaped.trajectory.map((step) => step.toolName),
      python.tools,
    );
  });

  void test(`${name}: intent, success and the answer's prose are Python's`, () => {
    assert.equal(shaped.intent, python.intent);
    assert.equal(shaped.success, python.success);
    assert.equal(shaped.message, python.message);
  });

  void test(`${name}: the data keys equal \`_available_data_keys\``, () => {
    assert.deepEqual(shaped.dataKeys, python.dataKeys);
  });

  void test(`${name}: the step count equals \`len(result.steps)\``, () => {
    assert.equal(shaped.stepCount, python.stepCount);
  });

  void test(`${name}: the locale is the one the turn was requested with`, () => {
    assert.equal(shaped.locale, python.locale);
  });

  void test(`${name}: the run's terminal status comes from the transcript read`, () => {
    assert.equal(shaped.runStatus, "succeeded");
  });
}

/**
 * The failed turn has no Python counterpart — its handler raises before an
 * `AgentResult` exists — so it is asserted against the contract instead: the
 * stream's `error` frame is an answer nobody can score, and the shaper must say
 * so rather than invent an empty success.
 */
void test("a failed turn shapes into the error intent, with nothing to score", () => {
  const shaped = shapedCapture("error");
  assert.equal(shaped.intent, "error");
  assert.equal(shaped.success, false);
  assert.equal(shaped.response, null);
  assert.deepEqual(shaped.trajectory, []);
  assert.equal(shaped.stepCount, 0);
});

void test("a failed turn still reports the run status the transcript read holds", () => {
  assert.equal(shapedCapture("error").runStatus, "failed");
});

/**
 * The one frame pairing the shaper cannot get from `tool-input-*` alone. A tool
 * that ran and threw is a MEASUREMENT — the trajectory has to keep the call and
 * mark it — so a shaper that dropped errored calls would quietly shorten every
 * failing case's trajectory into a passing one.
 */
void test("a tool that answered with an error keeps its place, marked", () => {
  const shaped = shapedCapture("search", {
    replace: ['"type":"tool-output-available","toolCallId":"search_bangumi-fixture","output":{"row_count":2}'],
    with: ['"type":"tool-output-error","toolCallId":"search_bangumi-fixture","errorText":"boom"'],
  });
  assert.deepEqual(
    shaped.trajectory.map((step) => step.status),
    ["ok", "error", "ok"],
  );
});

/**
 * A `tool-output-error` frame carries an `errorText` and no `output`: the call
 * answered nothing, and the verifier that reads returns must not be handed an
 * empty record it could read as one (E-3 #1382). Mutation: copy an output onto
 * the errored branch of `settledCall` and this goes red.
 */
void test("a tool that answered with an error published no return", () => {
  const shaped = shapedCapture("search", {
    replace: ['"type":"tool-output-available","toolCallId":"search_bangumi-fixture","output":{"row_count":2}'],
    with: ['"type":"tool-output-error","toolCallId":"search_bangumi-fixture","errorText":"boom"'],
  });
  assert.deepEqual(
    shaped.trajectory.map((step) => step.output),
    [{ bangumi_id: 12345 }, null, { point_count: 2 }],
  );
});

/**
 * A stream cut off mid-call is not a tool failure and not a success. Keeping the
 * call but leaving it `unsettled` is what stops W3-3's `ArgumentCorrectness`
 * port from scoring arguments against an answer nobody saw.
 */
void test("a call whose output never arrived is kept, and settled by nothing", () => {
  const shaped = shapedCapture("search", {
    replace: ['"type":"tool-output-available","toolCallId":"plan_route-fixture","output":{"point_count":2}'],
    with: ['"type":"start-step"'],
  });
  assert.deepEqual(
    shaped.trajectory.map((step) => [step.toolName, step.status]),
    [["resolve_anime", "ok"], ["search_bangumi", "ok"], ["plan_route", "unsettled"]],
  );
});

/**
 * The RETURN, which no Python evaluator reads and the final-reply verifier
 * cannot work without (E-3 #1382). `tool-output-available.output` is the
 * outcome's `details` verbatim (`session/turn-frames.ts::outputOf`), so what
 * the transcript keeps is the environment's own record of what came back.
 *
 * Mutation: fold `output` into a boolean "settled or not" and this goes red —
 * the values are the whole point.
 */
void test("each settled call keeps the return the stream published", () => {
  assert.deepEqual(
    shapedCapture("search").trajectory.map((step) => step.output),
    [{ bangumi_id: 12345 }, { row_count: 2 }, { point_count: 2 }],
  );
});

void test("a call the stream never settled published no return", () => {
  const shaped = shapedCapture("search", {
    replace: ['"type":"tool-output-available","toolCallId":"plan_route-fixture","output":{"point_count":2}'],
    with: ['"type":"start-step"'],
  });
  assert.deepEqual(
    shaped.trajectory.map((step) => [step.status, step.output]),
    [["ok", { bangumi_id: 12345 }], ["ok", { row_count: 2 }], ["unsettled", null]],
  );
});

/**
 * The intent gating, against the payload shape the edge builds TODAY.
 *
 * `RouteData` allows a route answer to carry search rows as well, and today's
 * `agent_result_to_response` emits exactly that pairing — while the recorded
 * capture above, taken before that change, carries only the itinerary. Python
 * gates on the intent (`_available_data_keys`), so a `plan_route` answer must
 * report `route` and nothing else no matter which of the two shapes arrives.
 */
void test("a route answer carrying search rows still reports only its route key", () => {
  const part = { intent: "plan_route", success: true, message: "", data: { results: {}, itinerary: {} } };
  assert.deepEqual(dataKeysOf(part), ["route"]);
});

void test("a multi-plan answer is the one intent that may report both keys", () => {
  const part = { intent: "plan_multi", success: true, message: "", data: { results: {}, itinerary: {} } };
  assert.deepEqual(dataKeysOf(part), ["results", "route"]);
});

void test("a search answer never reports a route key, whatever its data carries", () => {
  const part = { intent: "search_bangumi", success: true, message: "", data: { results: {}, itinerary: {} } };
  assert.deepEqual(dataKeysOf(part), ["results"]);
});
