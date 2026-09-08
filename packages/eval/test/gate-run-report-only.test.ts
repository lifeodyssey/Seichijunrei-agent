/**
 * The report-only column, and the four places it must NOT appear (E-3 #1382,
 * spec §十 10.3 「先 report-only」).
 *
 * A ninth entry in `metricNames()` would shift the committed Python baseline by
 * one position and the W3-5 double run would stop being a comparison
 * (`metric-names.ts`), so the metric is reported beside the scores and outside
 * every gate: not in `metricNames()`, not in `scores`, not among the verdict
 * rows, and not in the exit code.
 *
 * test-type: unit (canned report, pinned clock, no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Case, Dataset } from "logfire/evals";

import type { ExportedAgentExpected, ExportedAgentInput } from "../src/dataset-roundtrip.ts";
import { REPLY_CLAIM_METRIC } from "../src/evaluators/reply-claim-verifier.ts";
import { gateExitCode } from "../src/gate-run/gate-exit-code.ts";
import { gateRunResultOf, type AgentEvalReport } from "../src/gate-run/gate-run-result.ts";
import { BASELINE_MODEL } from "../src/gate-run/baseline-identity.ts";
import { metricNames } from "../src/metric-names.ts";
import type { TranscriptResult } from "../src/turn-transcript.ts";
import { baselineParityScores, GATED_DATASET, GENERATED_AT, makeGatedRun } from "./gated-run.ts";
import { makeReplyTurn } from "./make-reply-turn.ts";

/** `hasMeasuredSteps: true` because the gated fixture below is
 * `baselineParityScores`, which keeps only baseline cases carrying all eight
 * metrics — `step_efficiency` among them (#1439). */
const ALL_METRICS = metricNames({
  hasNonemptyCases: true,
  hasParamsRecorded: true,
  hasMeasuredSteps: true,
  l3Enabled: false,
});

/** Two rows and a count of two, so a reply stating two is right and one
 * stating five is wrong. */
const TWO_ROWS = { results: { row_count: 2, rows: [{ name: "宇治橋" }, { name: "京阪宇治駅" }] } };

/** The case's query IS the reply under measurement — `logfire/evals` hands a
 * task its inputs and nothing else, so that is where a canned reply can live. */
function repliedTurn(inputs: ExportedAgentInput): TranscriptResult {
  return makeReplyTurn({
    message: inputs.query,
    returns: [{ outcome: "ok", row_count: 2 }],
    data: TWO_ROWS,
  }).output;
}

function caseReplying(message: string): Case<ExportedAgentInput, TranscriptResult, ExportedAgentExpected> {
  return new Case<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>({
    name: message,
    inputs: makeReplyTurn({ message, query: message }).inputs,
    metadata: { acceptable_stages: [], data_keys: [], expect_nonempty: true },
  });
}

async function repliesReport(messages: readonly string[]): Promise<AgentEvalReport> {
  const dataset = new Dataset<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>({
    name: "report-only-run",
    cases: messages.map((message) => caseReplying(message)),
    evaluators: [],
  });
  return dataset.evaluate(repliedTurn);
}

/** An ungated run: no baseline and no gated columns, so the only thing this
 * result carries is the report-only one. */
function ungatedResultOf(report: AgentEvalReport) {
  return gateRunResultOf(report, {
    dataset: GATED_DATASET,
    caseCount: report.cases.length,
    metricNames: [],
    baseline: null,
    baselineModel: BASELINE_MODEL,
    baselineFailures: [],
    baselineWarnings: [],
    strata: {},
    strataWarnings: [],
    now: () => GENERATED_AT,
  });
}

const replies = await repliesReport([
  "2件見つかりました。",
  "5件見つかりました。",
  "承知しました。",
]);

void test("the column averages the replies it could decide, and no others", () => {
  assert.deepEqual(ungatedResultOf(replies).report_only[REPLY_CLAIM_METRIC], {
    measured_cases: 2,
    mean: 0.5,
  });
});

void test("a run whose every reply was undecidable reports no mean, not a zero", async () => {
  const undecidable = await repliesReport(["承知しました。", "かしこまりました。"]);

  assert.deepEqual(ungatedResultOf(undecidable).report_only[REPLY_CLAIM_METRIC], {
    measured_cases: 0,
    mean: null,
  });
});

/**
 * The mutation this file exists for: put the metric into `metricNames()` and
 * the oracle-pinned list in `test/metric-names.test.ts` goes red, along with
 * `aggregateScores`, which would then demand a column no case reports.
 */
void test("the metric is not one of the names a run is scored on", () => {
  assert.ok(!ALL_METRICS.includes(REPLY_CLAIM_METRIC));
});

const gated = await makeGatedRun(baselineParityScores(12));
const gatedResult = gateRunResultOf(gated.report, gated.settings);

void test("a gated run scores, compares and exits on the eight metrics only", () => {
  assert.deepEqual(Object.keys(gatedResult.scores), ALL_METRICS);
  assert.ok(!gatedResult.metrics.some((row) => row.metric === REPLY_CLAIM_METRIC));
  assert.equal(gateExitCode(gatedResult), 0);
});

void test("a gated run still reports the column beside its scores", () => {
  assert.deepEqual(gatedResult.report_only[REPLY_CLAIM_METRIC], { measured_cases: 0, mean: null });
});
