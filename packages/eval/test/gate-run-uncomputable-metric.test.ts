/**
 * Two runs that could not compute one metric at all.
 *
 * The metric's second witness is published by the deployed EDGE, so it is the
 * one metric a run can be unable to compute for reasons that say nothing about
 * the agent: a staging deploy without #1381, or a run whose every transcript
 * read failed. `aggregateScores` is strict on purpose — a metric the baseline
 * expects and the run does not report is a real failure, and Python raises
 * there too — so the column has to be dropped from the run's list rather than
 * tolerated in the check. Otherwise one unavailable measurement takes the other
 * seven down with it and the whole gate run dies.
 *
 * `step_efficiency` joined it in #1439: a turn that took no step on a case
 * whose every acceptable ideal is at least one has no denominator, so a run in
 * which every turn refused to act computes that one for nobody either.
 *
 * `nonempty_results` already had this shape; these are the same toggle, decided
 * per RUN instead of per dataset.
 *
 * test-type: unit (canned report, pinned clock, no network).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gateRunResultOf } from '../src/gate-run/gate-run-result.ts';
import { runMetricNames } from '../src/gate-run/run-metric-names.ts';
import {
  baselineParityScores,
  makeGatedRun,
  makeSteplessRun,
  makeUnwitnessedRun,
} from './gated-run.ts';

/** Twelve, because the gate skips a metric with fewer than ten paired cases. */
const PAIRED_CASES = 12;
const parity = baselineParityScores(PAIRED_CASES);

const unwitnessed = await makeUnwitnessedRun(parity);
const witnessed = await makeGatedRun(parity);
const stepless = await makeSteplessRun(parity);

function namesFor(run: { report: Parameters<typeof gateRunResultOf>[0] }): string[] {
  return runMetricNames({ report: run.report, hasNonemptyCases: true, l3Enabled: false });
}

void test('a run whose reads published no params does not report the metric at all', () => {
  assert.ok(!namesFor(unwitnessed).includes('argument_correctness'));
});

void test('one case with a published record is enough to keep the column', () => {
  assert.deepEqual(namesFor(witnessed)[0], 'argument_correctness');
});

void test('such a run still aggregates, and still reports its other metrics', () => {
  const result = gateRunResultOf(unwitnessed.report, {
    ...unwitnessed.settings,
    metricNames: namesFor(unwitnessed),
  });
  assert.ok(!('argument_correctness' in result.scores));
  assert.deepEqual(Object.keys(result.scores).sort(), [
    'data_keys_present',
    'locale_match',
    'max_tool_calls',
    'nonempty_results',
    'step_efficiency',
    'tool_correctness',
    'trajectory_match',
  ]);
});

/** The baseline still names the metric, so the comparison still has a row for
 * it — and finds no pair to compare. `skipped` is a warning and exits 0, which
 * is the same answer the gate gives any metric with too few pairs. */
void test('the uncomparable metric is skipped with a warning, and fails nothing', () => {
  const result = gateRunResultOf(unwitnessed.report, {
    ...unwitnessed.settings,
    metricNames: namesFor(unwitnessed),
  });
  const row = result.metrics.find((metric) => metric.metric === 'argument_correctness');
  assert.equal(row?.verdict, 'skipped');
  assert.deepEqual(result.failures, []);
});

void test('a run whose every turn took no required step does not report step efficiency', () => {
  assert.ok(!namesFor(stepless).includes('step_efficiency'));
});

void test('one case that did step is enough to keep that column', () => {
  assert.ok(namesFor(witnessed).includes('step_efficiency'));
});

void test('such a run still aggregates, and step efficiency is skipped not failed', () => {
  const result = gateRunResultOf(stepless.report, {
    ...stepless.settings,
    metricNames: namesFor(stepless),
  });
  const row = result.metrics.find((metric) => metric.metric === 'step_efficiency');
  assert.ok(!('step_efficiency' in result.scores));
  assert.equal(row?.verdict, 'skipped');
  assert.deepEqual(result.failures, []);
});
