import assert from 'node:assert/strict';
import { test } from 'node:test';

import { metricNames } from '../src/metric-names.ts';
import { ORACLE } from './evaluator-oracle.ts';

void test('a dataset with nonempty-tagged cases reports all eight metrics', () => {
  assert.deepEqual(
    metricNames({
      hasNonemptyCases: true,
      hasParamsRecorded: true,
      hasMeasuredSteps: true,
      l3Enabled: false,
    }),
    ORACLE.metricNames.withNonemptyCases,
  );
});

void test('without a nonempty-tagged case that column is not reported at all', () => {
  assert.deepEqual(
    metricNames({
      hasNonemptyCases: false,
      hasParamsRecorded: true,
      hasMeasuredSteps: true,
      l3Enabled: false,
    }),
    ORACLE.metricNames.withoutNonemptyCases,
  );
});

void test('a run whose reads published no settled params drops that column', () => {
  const dropped = metricNames({
    hasNonemptyCases: true,
    hasParamsRecorded: false,
    hasMeasuredSteps: true,
    l3Enabled: false,
  });
  assert.deepEqual(
    dropped,
    ORACLE.metricNames.withNonemptyCases.filter((name) => name !== 'argument_correctness'),
  );
});

void test('a run whose every turn skipped a required step drops that column', () => {
  const dropped = metricNames({
    hasNonemptyCases: true,
    hasParamsRecorded: true,
    hasMeasuredSteps: false,
    l3Enabled: false,
  });
  assert.deepEqual(
    dropped,
    ORACLE.metricNames.withNonemptyCases.filter((name) => name !== 'step_efficiency'),
  );
});

void test('the L3 judges append after the deterministic metrics', () => {
  const withJudges = metricNames({
    hasNonemptyCases: true,
    hasParamsRecorded: true,
    hasMeasuredSteps: true,
    l3Enabled: true,
  });

  assert.deepEqual(withJudges, [
    ...ORACLE.metricNames.withNonemptyCases,
    'task_completion',
    'hallucination_check',
  ]);
});
