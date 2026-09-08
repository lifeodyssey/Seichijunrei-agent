import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EVALUATOR_VERSION } from '../src/evaluators/agent-evaluator.ts';
import type { BaselineRecord } from '../src/gate/baseline-record.ts';
import {
  parseBaselineCandidate,
  unreadableResultRefusal,
  type BaselineCandidate,
} from '../src/gate-run/baseline-candidate.ts';
import { captureBaseline } from '../src/gate-run/baseline-capture.ts';
import { BASELINE_MODEL, BASELINE_TIER } from '../src/gate-run/baseline-identity.ts';
import { gateRunResultOf } from '../src/gate-run/gate-run-result.ts';
import { gateRunResultText } from '../src/gate-run/result-file.ts';
import { baselineParityScores, GATED_DATASET, makeGatedRun } from './gated-run.ts';

/**
 * Reading a committed gate run back as something that might become a baseline
 * (#1515). What follows the read is decided in
 * `gate-run-baseline-capture.test.ts`; this file is about the FILE — what makes
 * one readable, and what a capture is told when it is not.
 *
 * test-type: unit (a canned report and hand-written JSON, no network).
 */

/** Enough cases to be a run and few enough to build one in a unit test. */
const RUN_CASES = 12;

/** The record this candidate mints on a clean, empty path. */
function mintedFrom(candidate: BaselineCandidate, datasetCaseCount: number): BaselineRecord {
  const { record, refusals } = captureBaseline(candidate, {
    modelId: BASELINE_MODEL,
    tier: BASELINE_TIER,
    datasetCaseCount,
    recordExists: false,
    replace: false,
  });
  if (record === null) {
    throw new Error(`expected a captured record, got: ${refusals.join(' / ')}`);
  }
  return record;
}

function parsedCandidate(text: string): BaselineCandidate {
  const candidate = parseBaselineCandidate(text);
  if (candidate === null) {
    throw new Error('expected the result file to parse as a capture candidate');
  }
  return candidate;
}

/** The whole chain the coordinator runs: a gate run, its committed file, the
 * candidate read back out of it, and the record minted from that. */
void test('a committed gate run becomes a record carrying its own case scores', async () => {
  const scores = baselineParityScores(RUN_CASES);
  const run = await makeGatedRun(scores);
  const result = gateRunResultOf(run.report, run.settings);
  const candidate = parsedCandidate(gateRunResultText(result));

  const record = mintedFrom(candidate, result.case_count);

  assert.deepEqual(record.cases, scores);
  assert.deepEqual(record.scores, result.scores);
  assert.equal(record.case_count, RUN_CASES);
});

/** A finished run as the result file describes it, cut down to the fields a
 * capture reads. Each test below removes exactly one. */
const COMPLETE_RESULT = {
  generated_at: '2026-09-08T00:00:00.000Z',
  dataset: GATED_DATASET,
  evaluator_version: EVALUATOR_VERSION,
  case_count: 662,
  evaluated_count: 662,
  errored_count: 0,
  scores: {},
  case_scores: {},
  starved_cases: [],
  failures: [],
  metrics: [],
};

function resultWithout(dropped: string): string {
  const kept = Object.entries(COMPLETE_RESULT).filter(([field]) => field !== dropped);
  return JSON.stringify(Object.fromEntries(kept));
}

/**
 * Every field the capture reads is load-bearing. `case_scores` is the shape of
 * a result file written before #1515 — it cannot say what each case scored, so
 * it cannot become a record — and `failures` / `metrics` are the two lists the
 * fourth refusal reads, so a file naming neither cannot be asked whether its
 * red is a regression.
 */
for (const dropped of ['case_scores', 'failures', 'metrics', 'evaluator_version']) {
  void test(`a result file with no ${dropped} is not a candidate`, () => {
    assert.equal(parseBaselineCandidate(resultWithout(dropped)), null);
  });
}

void test('the complete shape IS a candidate, so the drops mean something', () => {
  assert.equal(parsedCandidate(JSON.stringify(COMPLETE_RESULT)).dataset, GATED_DATASET);
});

void test('a metric row without a verdict is not a candidate', () => {
  const text = JSON.stringify({
    generated_at: '2026-09-08T00:00:00.000Z',
    dataset: GATED_DATASET,
    evaluator_version: EVALUATOR_VERSION,
    case_count: 662,
    evaluated_count: 662,
    errored_count: 0,
    scores: {},
    case_scores: {},
    starved_cases: [],
    failures: [],
    metrics: [{ metric: 'tool_correctness' }],
  });

  assert.equal(parseBaselineCandidate(text), null);
});

void test('a truncated result file is refused rather than half-read', () => {
  assert.equal(parseBaselineCandidate('{"dataset": "agent_eval'), null);
});

void test('a file that cannot be read is refused in one sentence, not a stack', () => {
  const refusal = unreadableResultRefusal('results/nope.json');

  assert.equal(refusal.split('\n').length, 1);
  assert.ok(refusal.includes('results/nope.json'));
});

/** The refusal as the operator meets it: exit 1, one line, no stack. */
void test('the script refuses an unreadable --result the same way', () => {
  const script = fileURLToPath(new URL('../scripts/eval-baseline-capture.ts', import.meta.url));
  const run = spawnSync(process.execPath, [script, '--result', 'results/nope.json'], {
    encoding: 'utf8',
  });

  assert.equal(run.status, 1);
  assert.deepEqual(run.stderr.trimEnd().split('\n'), [unreadableResultRefusal('results/nope.json')]);
});
