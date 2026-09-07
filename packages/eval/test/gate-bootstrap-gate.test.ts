import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BaselineRecord } from '../src/gate/baseline-record.ts';
import {
  bootstrapGate,
  metricGateResults,
  type BootstrapGateOptions,
  type CaseScores,
  type GateOutcome,
} from '../src/gate/bootstrap-gate.ts';
import type { Interval } from '../src/gate/paired-bootstrap.ts';
import {
  oracleEntryNamed,
  readStatsOracle,
  type OracleGateCase,
} from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle().bootstrap_gates;
const real = oracleEntryNamed(oracle, 'real_baseline_subset');

/** The outcome an oracle entry describes, gated with the settings Python used. */
function makeGateOutcome(entry: OracleGateCase, overrides: BootstrapGateOptions = {}): GateOutcome {
  return bootstrapGate(entry.current_cases, entry.baseline, {
    iterations: entry.iterations,
    strata: entry.strata,
    ...overrides,
  });
}

for (const entry of oracle) {
  void test(`${entry.name}: the same failures Python returns`, () => {
    assert.deepEqual(makeGateOutcome(entry).failures, entry.failures);
  });

  void test(`${entry.name}: the same warnings Python logs`, () => {
    assert.deepEqual(makeGateOutcome(entry).warnings, entry.warnings);
  });
}

void test('a real Python baseline gates a synthetic run and names the regression', () => {
  assert.match(makeGateOutcome(real).failures.join('\n'), /^tool_correctness: mean_delta=/);
});

/**
 * The strata reach the resampler, and are not quietly dropped on the way
 * (`case-strata.ts`' whole reason to read the canonical dataset).
 *
 * The partition compared against is one case per stratum, because that one is
 * decidable from the algorithm rather than from the data: a resample that
 * cannot mix two cases collapses the interval onto the estimate. Comparing
 * against the EMPTY map — every case in one `unstratified` group — used to
 * differ on the 2026-08 record and no longer does on the 2026-09-07 one
 * (#1303): these forty deltas are all but two 1.0, so the bootstrap
 * distribution is coarse enough that both partitions land on the same
 * quantised bounds. That was data luck, not a property.
 */
void test('losing the strata changes the interval the gate reports', () => {
  const oneEach = Object.fromEntries(Object.keys(real.current_cases).map((id) => [id, id]));
  const outcome = makeGateOutcome(real, { strata: oneEach });
  assert.notDeepEqual(outcome.failures, real.failures);
});

void test('too few paired cases is skipped, never guessed at', () => {
  const outcome = makeGateOutcome(oracleEntryNamed(oracle, 'few_pairs'));
  assert.deepEqual(outcome, {
    failures: [],
    warnings: ['Skipping metric: only 5 paired cases, need 10'],
  });
});

void test('an indeterminate metric is reported without blocking', () => {
  const outcome = makeGateOutcome(oracleEntryNamed(oracle, 'indeterminate'));
  assert.deepEqual(outcome.failures, []);
  assert.match(outcome.warnings.join('\n'), /^INDETERMINATE metric: /);
});

void test('a lower min_paired lets the skipped metric through', () => {
  const outcome = makeGateOutcome(oracleEntryNamed(oracle, 'few_pairs'), { minPaired: 5 });
  assert.deepEqual(outcome.warnings, []);
});

void test('a baseline the run never touched has nothing to pair', () => {
  const outcome = bootstrapGate({}, real.baseline, { iterations: real.iterations });
  assert.deepEqual(outcome.failures, []);
  assert.equal(outcome.warnings.length, 8);
});

/**
 * The property the strata exist for, on data built to show it (#1303).
 *
 * `paired-bootstrap.ts` says it in one line — "pooling the deltas would let a
 * small stratum that carries a regression wash out" — and until now nothing
 * measured it. Three cases in `rare` lose a whole point; seventeen in `common`
 * lose nothing. Stratified resampling draws three from `rare` every single
 * draw, so the estimate is 3/20 on all of them and the interval is a point.
 * Pooled resampling draws twenty from the mixed pool, and misses all three
 * about 4% of the time — over the 2.5th percentile, so the lower bound is 0.
 */
const RARE_CASES = ['rare_1', 'rare_2', 'rare_3'];
const COMMON_CASES = Array.from({ length: 17 }, (_, index) => `common_${String(index)}`);

const UNIFORM_BASELINE: BaselineRecord = {
  schema_version: 2,
  model: 'small-stratum',
  dataset: 'agent_eval_v3',
  tier: 'trajectory',
  evaluator_version: null,
  repeat: 1,
  case_count: RARE_CASES.length + COMMON_CASES.length,
  evaluated_count: RARE_CASES.length + COMMON_CASES.length,
  errored_count: 0,
  scores: { score: 1 },
  cases: {},
  note: null,
};

function scoredCases(ids: readonly string[], score: number): CaseScores {
  return Object.fromEntries(ids.map((id): [string, Record<string, number>] => [id, { score }]));
}

function stratumOf(ids: readonly string[], name: string): Record<string, string> {
  return Object.fromEntries(ids.map((id): [string, string] => [id, name]));
}

const PERFECT_CASES: CaseScores = {
  ...scoredCases(RARE_CASES, 1),
  ...scoredCases(COMMON_CASES, 1),
};
const RARE_REGRESSION_BASELINE: BaselineRecord = { ...UNIFORM_BASELINE, cases: PERFECT_CASES };
const RARE_REGRESSION_RUN: CaseScores = { ...PERFECT_CASES, ...scoredCases(RARE_CASES, 0) };
const RARE_REGRESSION_STRATA = {
  ...stratumOf(RARE_CASES, 'rare'),
  ...stratumOf(COMMON_CASES, 'common'),
};

function rareStratumInterval(strata: Record<string, string>): Interval | null {
  const [row] = metricGateResults(RARE_REGRESSION_RUN, RARE_REGRESSION_BASELINE, { strata });
  return row?.comparison?.interval ?? null;
}

void test('a regression in a three-case stratum survives stratified resampling', () => {
  assert.deepEqual(rareStratumInterval(RARE_REGRESSION_STRATA), { lower: 0.15, upper: 0.15 });
});

void test('the same regression washes out when the deltas are pooled', () => {
  assert.deepEqual(rareStratumInterval({}), { lower: 0, upper: 0.35 });
});
