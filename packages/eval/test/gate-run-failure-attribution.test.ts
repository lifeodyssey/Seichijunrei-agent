/**
 * What a failed case is, and what the run says about it (E-4 #1383, spec §十
 * 10.4).
 *
 * The definition is the run's own: an errored case is the error-rate gate's and
 * is only counted; an evaluated case failed when one of the scores the gate
 * already keeps per case is below the maximum every evaluator emits for
 * "nothing was violated". The mutations pinned here: attribute passing cases
 * too; drop the errored-step signal (the case whose only deviation is a failure
 * then has no record); let the attribution reach the verdict.
 *
 * test-type: unit (canned report, pinned clock, no network).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REPLY_CLAIM_METRIC } from '../src/evaluators/reply-claim-verifier.ts';
import { gateExitCode } from '../src/gate-run/gate-exit-code.ts';
import { analyseFailures } from '../src/gate-run/failure-attribution.ts';
import type { Deviation } from '../src/gate-run/first-deviation.ts';
import { gateRunResultOf, type GateRunResult } from '../src/gate-run/gate-run-result.ts';
import { PYTHON_BASELINE_MODEL } from '../src/gate-run/python-baseline.ts';
import { makeCannedReport, type CannedCaseSpec } from './canned-report.ts';
import { GATED_DATASET, GENERATED_AT, makeFallenOverRun, baselineParityScores } from './gated-run.ts';
import { makeAttributedTurn } from './make-attributed-turn.ts';

const PERFECT = { tool_correctness: 1, trajectory_match: 1, locale_match: 1 };

function resultOf(specs: readonly CannedCaseSpec[]): GateRunResult {
  return gateRunResultOf(makeCannedReport(specs), {
    dataset: GATED_DATASET,
    caseCount: specs.length,
    metricNames: [],
    baseline: null,
    baselineModel: PYTHON_BASELINE_MODEL,
    baselineFailures: [],
    baselineWarnings: [],
    strata: {},
    strataWarnings: [],
    now: () => GENERATED_AT,
  });
}

/** The one case that did everything right — its scores are all at maximum. */
const passing: CannedCaseSpec = {
  name: 'passing',
  scores: PERFECT,
  turn: makeAttributedTurn({ stages: ['search_nearby'], steps: [{ tool: 'search_nearby' }] }),
};

/** Called the wrong tool: `trajectory_match` says so, the rules say where. */
const diverged: CannedCaseSpec = {
  name: 'diverged',
  scores: { ...PERFECT, trajectory_match: 0 },
  turn: makeAttributedTurn({ stages: ['search_bangumi'], steps: [{ tool: 'search_nearby' }] }),
};

/** Only an errored step: the completed calls matched the chain exactly and the
 * reply claims nothing, so signal 2 is the sole thing placing this case. */
const failedCall: CannedCaseSpec = {
  name: 'failed_call',
  scores: { ...PERFECT, max_tool_calls: 0 },
  turn: makeAttributedTurn({
    stages: ['search_nearby'],
    steps: [{ tool: 'search_nearby' }, { tool: 'search_nearby', status: 'error' }],
  }),
};

/** Failed on a metric with no place in a trajectory: the turn was clean, the
 * reply was in the wrong language. Nothing to point at, and nothing invented. */
const wrongLanguage: CannedCaseSpec = {
  name: 'wrong_language',
  scores: { ...PERFECT, locale_match: 0 },
  turn: makeAttributedTurn({ stages: ['search_nearby'], steps: [{ tool: 'search_nearby' }] }),
};

const run = resultOf([passing, diverged, failedCall, wrongLanguage]);

void test('only the failed cases are attributed, and the passing one is nowhere', () => {
  assert.deepEqual(
    run.failure_attribution.cases.map((one) => one.case_id),
    ['diverged', 'failed_call'],
  );
  assert.ok(!run.failure_attribution.unattributed.includes('passing'));
  assert.equal(run.failure_attribution.failed_cases, 3);
});

void test('the record separates the main cause from the metrics it cost', () => {
  assert.deepEqual(run.failure_attribution.cases[0], {
    case_id: 'diverged',
    cause: {
      category: 'wrong_tool',
      locus: 'step',
      step_index: 0,
      claim_index: null,
      tool_name: 'search_nearby',
      expected_tool: 'resolve_anime',
    },
    consequences: [],
    failed_metrics: { trajectory_match: 0 },
  });
});

/**
 * Two failures, and the call the chain still wanted because neither settled:
 * THREE deviations on one case, so "the first" and "the last" are different
 * answers — a case with one deviation could not tell them apart.
 */
const cascade = resultOf([
  {
    name: 'cascade',
    scores: { ...PERFECT, tool_correctness: 0 },
    turn: makeAttributedTurn({
      stages: ['search_nearby'],
      steps: [
        { tool: 'search_nearby', status: 'error' },
        { tool: 'search_nearby', status: 'error' },
      ],
    }),
  },
]);

function placement(one: Deviation): string {
  return `${one.category}@${String(one.step_index)}`;
}

void test('the record names the first deviation as the cause and the rest as fallout', () => {
  assert.deepEqual(
    cascade.failure_attribution.cases.map((one) => ({
      cause: placement(one.cause),
      consequences: one.consequences.map(placement),
    })),
    [{ cause: 'tool_error@0', consequences: ['tool_error@1', 'missing_call@2'] }],
  );
});

void test('a case placed only by its errored step is still attributed', () => {
  const placed = run.failure_attribution.cases.filter((one) => one.case_id === 'failed_call');

  assert.deepEqual(
    placed.map((one) => [one.cause.category, one.cause.step_index]),
    [['tool_error', 1]],
  );
});

void test('a failed case the rules cannot place is named, never given an index', () => {
  assert.deepEqual(run.failure_attribution.unattributed, ['wrong_language']);
  assert.equal(run.failure_attribution.failed_cases, 3);
  assert.deepEqual(run.failure_attribution.by_category, { wrong_tool: 1, tool_error: 1 });
});

void test('an errored case is counted and never attributed — it has no turn to read', async () => {
  const fallen = await makeFallenOverRun(baselineParityScores(3));

  assert.deepEqual(analyseFailures(fallen.report), {
    failedCases: [],
    unattributed: [],
    erroredCases: 3,
  });
});

/** Everything the gate decides, with the attribution removed: the bytes that
 * must not move when only the attribution does. */
function verdictBytes(result: GateRunResult): string {
  const { failure_attribution: _attribution, ...verdict } = result;
  return JSON.stringify(verdict);
}

/**
 * The same four cases with the same four score records, failing in different
 * places: a different category per case, and one MORE case attributable than
 * before. Both halves matter — a run that recorded attributed cases as failures,
 * or one that let a category reach a verdict row, would move these bytes.
 */
const sameScoresDifferentTurn = resultOf([
  passing,
  { ...diverged, turn: failedCall.turn },
  failedCall,
  { ...wrongLanguage, turn: diverged.turn },
]);

void test('the verdict is byte-identical whichever way the same scores failed', () => {
  assert.equal(verdictBytes(run), verdictBytes(sameScoresDifferentTurn));
  assert.equal(gateExitCode(run), gateExitCode(sameScoresDifferentTurn));
});

void test('and the attribution did move, so the comparison above proved something', () => {
  assert.deepEqual(sameScoresDifferentTurn.failure_attribution.by_category, {
    tool_error: 2,
    wrong_tool: 1,
  });
  assert.deepEqual(sameScoresDifferentTurn.failure_attribution.unattributed, []);
});

void test('the attribution is in no scored, compared or named column', () => {
  assert.deepEqual(Object.keys(run.scores), []);
  assert.deepEqual(run.metrics, []);
  assert.ok(!Object.keys(run.report_only).includes('failure_attribution'));
  assert.deepEqual(Object.keys(run.report_only), [REPLY_CLAIM_METRIC]);
});
