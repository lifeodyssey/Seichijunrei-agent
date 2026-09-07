import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { EVALUATOR_VERSION } from '../src/evaluators/agent-evaluator.ts';
import { baselinePath, writeBaselineRecord } from '../src/gate/baseline-store.ts';
import { canonicalDatasetPath, loadCaseStrata } from '../src/gate/case-strata.ts';
import {
  gateRunSettingsFromBaseline,
  type RunUnderGate,
} from '../src/gate-run/baseline-gated-settings.ts';
import { gateExitCode } from '../src/gate-run/gate-exit-code.ts';
import { gateRunResultOf } from '../src/gate-run/gate-run-result.ts';
import { PYTHON_BASELINE_LAYER, PYTHON_BASELINE_MODEL } from '../src/gate-run/python-baseline.ts';
import { metricNames } from '../src/metric-names.ts';
import {
  baselineParityScores,
  GENERATED_AT,
  GATED_DATASET,
  makeAgentCase,
  makeReport,
  pythonBaseline,
} from './gated-run.ts';

/** Twelve, because the gate skips a metric with fewer than ten paired cases. */
const PAIRED_CASES = 12;
const METRICS = metricNames({
  hasNonemptyCases: true,
  hasParamsRecorded: true,
  hasMeasuredSteps: true,
  l3Enabled: false,
});
const scores = baselineParityScores(PAIRED_CASES);
const report = await makeReport(
  Object.keys(scores).map((name) => makeAgentCase(name)),
  scores,
);

/** The half of the settings a run knows before the baseline is read. */
function runUnderGate(caseCount: number): RunUnderGate {
  return {
    dataset: GATED_DATASET,
    caseCount,
    metricNames: METRICS,
    strata: loadCaseStrata(canonicalDatasetPath(GATED_DATASET)),
    now: () => GENERATED_AT,
  };
}

const damagedDir = mkdtempSync(join(tmpdir(), 'animichi-damaged-'));
const damagedLocation = {
  layer: PYTHON_BASELINE_LAYER,
  modelId: PYTHON_BASELINE_MODEL,
  baselinesDir: damagedDir,
};
writeFileSync(baselinePath(damagedLocation), '{"schema_version":2,"cases":', 'utf8');
const damagedSettings = gateRunSettingsFromBaseline(damagedLocation, runUnderGate(PAIRED_CASES));
const damagedResult = gateRunResultOf(report, damagedSettings);

void test('a damaged baseline is a failure that names the record it could not read', () => {
  assert.deepEqual(damagedResult.failures, [
    `Invalid baseline for ${PYTHON_BASELINE_LAYER}/${PYTHON_BASELINE_MODEL} at ${baselinePath(damagedLocation)}: not a schema-v2 baseline record`,
  ]);
});

void test('a damaged baseline blocks rather than ungating the run', () => {
  assert.equal(gateExitCode(damagedResult), 1);
});

const healthyDir = mkdtempSync(join(tmpdir(), 'animichi-healthy-'));
const healthyLocation = {
  layer: PYTHON_BASELINE_LAYER,
  modelId: PYTHON_BASELINE_MODEL,
  baselinesDir: healthyDir,
};
const baseline = pythonBaseline();
writeBaselineRecord(baseline, healthyLocation);
const healthySettings = gateRunSettingsFromBaseline(
  healthyLocation,
  runUnderGate(baseline.case_count),
);

void test('a readable baseline carries no failures', () => {
  assert.deepEqual(healthySettings.baselineFailures, []);
});

void test('a readable baseline is the record the gate decides with', () => {
  assert.ok(healthySettings.baseline !== null);
});

void test('the baseline the gate names is the one it was located at', () => {
  assert.equal(healthySettings.baselineModel, PYTHON_BASELINE_MODEL);
});

/**
 * A record scored by another vocabulary blocks exactly as a damaged one does
 * (#1303). It is the same kind of damage: the numbers are readable and not
 * comparable, and warning about it would leave an ungated run that reads like a
 * legitimate first one — which is how the `official-v1` record survived #1439,
 * #1454 and #1461 and would have manufactured regressions here.
 */
const staleVocabularyDir = mkdtempSync(join(tmpdir(), 'animichi-vocabulary-'));
const staleVocabularyLocation = {
  layer: PYTHON_BASELINE_LAYER,
  modelId: PYTHON_BASELINE_MODEL,
  baselinesDir: staleVocabularyDir,
};
writeBaselineRecord(
  { ...baseline, evaluator_version: 'official-v1' },
  staleVocabularyLocation,
);
const staleVocabularyResult = gateRunResultOf(
  report,
  gateRunSettingsFromBaseline(staleVocabularyLocation, runUnderGate(baseline.case_count)),
);

void test('a baseline from another evaluator version fails, naming both versions', () => {
  assert.deepEqual(staleVocabularyResult.failures, [
    `Baseline for ${PYTHON_BASELINE_LAYER}/${PYTHON_BASELINE_MODEL} was scored by evaluator official-v1, this runner scores ${EVALUATOR_VERSION}`,
  ]);
});

void test('a baseline from another evaluator version blocks rather than ungating', () => {
  assert.equal(gateExitCode(staleVocabularyResult), 1);
});
