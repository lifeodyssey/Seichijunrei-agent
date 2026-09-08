import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { bootstrapGate } from '../src/gate/bootstrap-gate.ts';
import { gateInputFromReport } from '../src/gate/report-gate-input.ts';
import { gateExitCode } from '../src/gate-run/gate-exit-code.ts';
import { gateRunResultOf, type GateRunResult } from '../src/gate-run/gate-run-result.ts';
import { resultFileName, writeGateRunResult } from '../src/gate-run/result-file.ts';
import { metricNames } from '../src/metric-names.ts';
import {
  baselineParityScores,
  makeFallenOverRun,
  makeGatedRun,
  committedBaseline,
  withRegressedMetric,
  type CaseScoreMap,
} from './gated-run.ts';

/** Twelve, because the gate skips a metric with fewer than ten paired cases. */
const PAIRED_CASES = 12;
const ALL_METRICS = metricNames({
  hasNonemptyCases: true,
  hasParamsRecorded: true,
  hasMeasuredSteps: true,
  l3Enabled: false,
});
const parity = baselineParityScores(PAIRED_CASES);
const regressed = withRegressedMetric(parity, 'tool_correctness');

async function gateRun(scores: CaseScoreMap): Promise<GateRunResult> {
  const run = await makeGatedRun(scores);
  return gateRunResultOf(run.report, run.settings);
}

const parityResult = await gateRun(parity);
const regressedResult = await gateRun(regressed);

/** The same comparison made by the gate the port already pins to Python. */
async function directGate(scores: CaseScoreMap) {
  const run = await makeGatedRun(scores);
  return bootstrapGate(gateInputFromReport(run.report).cases, committedBaseline(), {
    strata: run.settings.strata,
  });
}

function verdictOf(result: GateRunResult, metric: string): string {
  const row = result.metrics.find((one) => one.metric === metric);
  return row?.verdict ?? 'absent';
}

void test('the result names every metric the Python harness reports', () => {
  assert.deepEqual(Object.keys(parityResult.scores), ALL_METRICS);
});

void test('every reported metric also carries a verdict row', () => {
  assert.deepEqual(
    [...parityResult.metrics.map((row) => row.metric)].sort(),
    [...ALL_METRICS].sort(),
  );
});

void test('the failures are the ones a direct bootstrapGate call reports', async () => {
  assert.deepEqual(regressedResult.failures, (await directGate(regressed)).failures);
});

void test('the warnings are the ones a direct bootstrapGate call reports', async () => {
  assert.deepEqual(parityResult.warnings, (await directGate(parity)).warnings);
});

void test('a run that matches the baseline passes every metric', () => {
  assert.deepEqual(
    parityResult.metrics.map((row) => row.verdict),
    ALL_METRICS.map(() => 'pass'),
  );
});

void test('a regressed metric is the one marked fail', () => {
  assert.equal(verdictOf(regressedResult, 'tool_correctness'), 'fail');
});

void test('the metric that regressed is the one the failure line names', () => {
  assert.match(regressedResult.failures.join('\n'), /^tool_correctness: mean_delta=/);
});

void test('a metric nobody touched still passes beside the failing one', () => {
  assert.equal(verdictOf(regressedResult, 'locale_match'), 'pass');
});

void test('a passing run exits zero', () => {
  assert.equal(gateExitCode(parityResult), 0);
});

void test('a failing metric flips the exit code', () => {
  assert.equal(gateExitCode(regressedResult), 1);
});

/** `baseline - current` for the metric this run drove to zero: the mean of the
 * baseline's own `tool_correctness` over the paired cases. Read off the record
 * rather than written down, because the record is refreshed whenever the
 * evaluators change (#1303) and a literal would then be pinning last quarter's
 * run instead of the arithmetic. */
const REGRESSED_MEAN_DELTA =
  Object.values(parity).reduce((total, scores) => total + (scores.tool_correctness ?? NaN), 0) /
  PAIRED_CASES;

void test('the interval and the estimate ride along with the verdict', () => {
  const row = regressedResult.metrics.find((one) => one.metric === 'tool_correctness');
  assert.deepEqual(
    { delta: row?.mean_delta, n: row?.sample_size, method: row?.method },
    { delta: REGRESSED_MEAN_DELTA, n: PAIRED_CASES, method: 'stratified-paired-bootstrap' },
  );
});

void test('the seed and iterations the verdict was reached with are recorded', () => {
  assert.deepEqual(
    { seed: parityResult.seed, iterations: parityResult.iterations, minEffect: parityResult.min_effect },
    { seed: 309, iterations: 2000, minEffect: 0.01 },
  );
});

void test('the run counts distinguish the cases asked for from the ones scored', () => {
  assert.deepEqual(
    {
      cases: parityResult.case_count,
      evaluated: parityResult.evaluated_count,
      errored: parityResult.errored_count,
    },
    { cases: PAIRED_CASES, evaluated: PAIRED_CASES, errored: 0 },
  );
});

void test('the file is named for the run date and the dataset', () => {
  assert.equal(resultFileName(parityResult), '2026-09-05-agent_eval_v3.json');
});

void test('the written file is the record, byte for byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-gate-'));
  const path = writeGateRunResult(parityResult, dir);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), JSON.parse(JSON.stringify(parityResult)));
});

const MISSING_BASELINE = 'Missing baseline for agent_l4_trajectory/openai:mimo-v2.5 at /nowhere';
const ungatedRun = await makeGatedRun(regressed);
const ungatedResult = gateRunResultOf(ungatedRun.report, {
  ...ungatedRun.settings,
  baseline: null,
  baselineWarnings: [MISSING_BASELINE],
});

void test('without a baseline no metric is compared', () => {
  assert.deepEqual(ungatedResult.metrics, []);
});

void test('the reason there was no baseline is carried into the result', () => {
  assert.deepEqual(ungatedResult.warnings, [MISSING_BASELINE]);
});

void test('an ungated run reports rather than blocks, even when it regressed', () => {
  assert.equal(gateExitCode(ungatedResult), 0);
});

const INVALID_BASELINE = 'Invalid baseline for agent_l4_trajectory/openai:mimo-v2.5 at /nowhere: not a schema-v2 baseline record';
const damagedResult = gateRunResultOf(ungatedRun.report, {
  ...ungatedRun.settings,
  baseline: null,
  baselineFailures: [INVALID_BASELINE],
  baselineWarnings: [],
});

void test('a damaged baseline is carried into the result as a failure', () => {
  assert.deepEqual(damagedResult.failures, [INVALID_BASELINE]);
});

void test('a damaged baseline blocks rather than ungating the run', () => {
  assert.equal(gateExitCode(damagedResult), 1);
});

void test('a run where every turn fell over has no scores to gate', async () => {
  const fallen = await makeFallenOverRun(parity);
  assert.throws(() => gateRunResultOf(fallen.report, fallen.settings), /All cases errored/);
});
