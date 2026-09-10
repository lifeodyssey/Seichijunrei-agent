import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EVALUATOR_VERSION } from '../src/evaluators/agent-evaluator.ts';
import {
  baselineRecordText,
  parseBaselineRecord,
  type BaselineRecord,
} from '../src/gate/baseline-record.ts';
import { comparisonSentencePrefix } from '../src/gate/metric-gate.ts';
import { oracleEntryNamed, readStatsOracle } from '../src/gate/stats-oracle.ts';
import type { BaselineCandidate } from '../src/gate-run/baseline-candidate.ts';
import { captureBaseline, type CaptureTerms } from '../src/gate-run/baseline-capture.ts';
import { BASELINE_MODEL, BASELINE_TIER } from '../src/gate-run/baseline-identity.ts';
import { GATED_DATASET } from './gated-run.ts';

/** One finished run offered as a baseline: uncapped, unstarved, scored. */
function makeBaselineCandidate(overrides: Partial<BaselineCandidate> = {}): BaselineCandidate {
  return {
    generated_at: '2026-09-08T09:30:00.000Z',
    dataset: GATED_DATASET,
    evaluator_version: EVALUATOR_VERSION,
    case_count: 662,
    evaluated_count: 662,
    errored_count: 0,
    scores: { tool_correctness: 0.5 },
    case_scores: { 'case-0': { tool_correctness: 1 }, 'case-1': { tool_correctness: 0 } },
    starved_cases: [],
    failures: [],
    metrics: [{ metric: 'tool_correctness', verdict: 'pass' }],
    ...overrides,
  };
}

/** The one red a first capture may carry: the TS run scoring below the record
 * it retires, reported by `metric-gate.ts` as this sentence. */
const REGRESSION = oracleEntryNamed(readStatsOracle().bootstrap_gates, 'real_baseline_subset');

/** The same run, red for a reason that is not a regression. */
function makeRedRun(failure: string, verdict: string): BaselineCandidate {
  return makeBaselineCandidate({
    failures: [failure],
    metrics: [{ metric: 'tool_correctness', verdict }],
  });
}

/** The identity and the disk state the script hands the decision. */
function makeCaptureTerms(overrides: Partial<CaptureTerms> = {}): CaptureTerms {
  return {
    modelId: BASELINE_MODEL,
    tier: BASELINE_TIER,
    datasetCaseCount: 662,
    recordExists: false,
    replace: false,
    ...overrides,
  };
}

function capturedRecord(run: BaselineCandidate, terms: CaptureTerms): BaselineRecord {
  const { record, refusals } = captureBaseline(run, terms);
  if (record === null) {
    throw new Error(`expected a captured record, got: ${refusals.join(' / ')}`);
  }
  return record;
}

void test('the record parser accepts what a capture writes, field for field', () => {
  const record = capturedRecord(makeBaselineCandidate(), makeCaptureTerms());
  assert.deepEqual(parseBaselineRecord(baselineRecordText(record)), record);
});

void test('a capture stamps the pinned identity and the vocabulary of the run', () => {
  const record = capturedRecord(makeBaselineCandidate(), makeCaptureTerms());
  assert.equal(record.model, BASELINE_MODEL);
  assert.equal(record.tier, BASELINE_TIER);
  assert.equal(record.evaluator_version, EVALUATOR_VERSION);
  assert.equal(record.schema_version, 2);
});

/** The vocabulary is the RUN's, not this checkout's: a record stamped from the
 * code at capture time would claim a version that never touched the scores. */
void test('a capture keeps the vocabulary the run was scored in', () => {
  const run = makeBaselineCandidate({ evaluator_version: 'official-v1' });
  assert.equal(capturedRecord(run, makeCaptureTerms()).evaluator_version, 'official-v1');
});

void test('the captured record says where it came from', () => {
  const record = capturedRecord(makeBaselineCandidate(), makeCaptureTerms());
  assert.equal(
    record.note,
    "captured from the TS tier's agent_eval_v3 gate run of 2026-09-08T09:30:00.000Z (#1515)",
  );
});

/** #1499: judgeable is not mintable. One starved case is enough to refuse. */
void test('a run with any starved case is refused, by the count', () => {
  const run = makeBaselineCandidate({ starved_cases: ['case-0'] });
  const { record, refusals } = captureBaseline(run, makeCaptureTerms());
  assert.equal(record, null);
  assert.deepEqual(refusals, [
    'refusing to write a baseline from a run with 1/662 starved cases: the ' +
      'record would make an outage the floor every later run is judged ' +
      'against. Re-run the suite; a clean run mints it.',
  ]);
});

void test('a capped run is refused, naming both counts', () => {
  const run = makeBaselineCandidate({ case_count: 3, evaluated_count: 3 });
  const { record, refusals } = captureBaseline(run, makeCaptureTerms());
  assert.equal(record, null);
  assert.deepEqual(refusals, [
    "refusing to write a baseline from a capped run: it set out to evaluate 3 of " +
      "agent_eval_v3's 662 cases, and a record describing a subset is stale for " +
      'every uncapped run after it. Re-run without --limit.',
  ]);
});

void test('the standing baseline is not overwritten without --replace', () => {
  const terms = makeCaptureTerms({ recordExists: true });
  const { record, refusals } = captureBaseline(makeBaselineCandidate(), terms);
  assert.equal(record, null);
  assert.deepEqual(refusals, [
    'refusing to overwrite the committed baseline: it is the floor every run ' +
      'is judged against today. Pass --replace to retire it.',
  ]);
});

void test('--replace retires the standing baseline', () => {
  const terms = makeCaptureTerms({ recordExists: true, replace: true });
  assert.equal(capturedRecord(makeBaselineCandidate(), terms).dataset, GATED_DATASET);
});

/** Every reason at once, so a fix for one does not hide the others. */
void test('a capped, starved run on an occupied path gives all three refusals', () => {
  const run = makeBaselineCandidate({ case_count: 3, starved_cases: ['case-0'] });
  const { refusals } = captureBaseline(run, makeCaptureTerms({ recordExists: true }));
  assert.equal(refusals.length, 3);
});

/**
 * The recogniser is an ALLOW list keyed on the comparison sentence's own
 * prefix, so it has to be the prefix Python writes. `real_baseline_subset` is
 * the oracle's regression row and `starved_pairs` is the one that must NOT
 * look like one — same metric, same colon, different sentence entirely.
 */
void test('the oracle regression sentence is the one the recogniser allows', () => {
  const starved = oracleEntryNamed(readStatsOracle().bootstrap_gates, 'starved_pairs');

  assert.ok(REGRESSION.failures[0]?.startsWith(comparisonSentencePrefix('tool_correctness')));
  assert.ok(!starved.failures[0]?.startsWith(comparisonSentencePrefix('metric')));
});

void test('a run red only against the record it replaces still mints', () => {
  const run = makeRedRun(REGRESSION.failures[0] ?? '', 'fail');
  assert.equal(capturedRecord(run, makeCaptureTerms()).dataset, GATED_DATASET);
});

void test('an outage failure refuses, whatever the metrics say', () => {
  const outage = readStatsOracle().provider_outage_gates;
  const run = makeRedRun(oracleEntryNamed(outage, 'total_outage').failure ?? '', 'fail');
  const { record, refusals } = captureBaseline(run, makeCaptureTerms());

  assert.equal(record, null);
  assert.ok(refusals[0]?.startsWith('refusing to write a baseline from a run whose red'));
});

/** No baseline names `error_rate` as a metric, so the run carries no row for
 * it and its comparison-shaped sentence is never explained. */
/** Explained means explained by a row that FAILED. A comparison sentence for a
 * metric the gate passed is a file that has been edited, not a regression. */
void test('a comparison sentence no failed row accounts for still refuses', () => {
  const run = makeRedRun(REGRESSION.failures[0] ?? '', 'pass');

  assert.equal(captureBaseline(run, makeCaptureTerms()).record, null);
});

void test('an error-rate regression refuses even though it reads like one', () => {
  const run = makeRedRun('error_rate: mean_delta=0.3000, ci=[0.1, 0.5], n=40, method=x', 'fail');

  assert.equal(captureBaseline(run, makeCaptureTerms()).record, null);
});

void test('a metric starvation emptied refuses, and it is not a regression', () => {
  const starved = oracleEntryNamed(readStatsOracle().bootstrap_gates, 'starved_pairs');
  const run = makeRedRun(starved.failures[0] ?? '', 'skipped');

  assert.equal(captureBaseline(run, makeCaptureTerms()).record, null);
});
