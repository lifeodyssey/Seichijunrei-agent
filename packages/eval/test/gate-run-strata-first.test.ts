import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { canonicalDatasetPath, pooledStratumWarning } from '../src/gate/case-strata.ts';
import { gateRunResultOf } from '../src/gate-run/gate-run-result.ts';
import { evaluateAfterStrata } from '../src/gate-run/strata-first-run.ts';
import { baselineParityScores, makeGatedRun } from './gated-run.ts';

/**
 * #1478: the strata load BEFORE the turns, and what the load had to say
 * survives into the result. The run this guards costs a real staging turn per
 * case, so "the task was never called" is the whole assertion — a refusal after
 * the run is a refusal nobody can afford twice.
 */

/** A run that records whether it was ever asked to take its turns. */
class CountedRun {
  calls = 0;

  evaluate = (): Promise<string> => {
    this.calls += 1;
    return Promise.resolve('turns taken');
  };
}

function datasetFile(rows: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'animichi-strata-')), 'set.json');
  writeFileSync(path, rows, 'utf8');
  return path;
}

void test('a malformed row refuses before a single turn is submitted', async () => {
  const run = new CountedRun();
  await assert.rejects(
    evaluateAfterStrata(datasetFile('[{"id": "a", "path": "p"}, {"path": "q"}]'), run.evaluate),
    /row 1 has no string "id"/,
  );
  assert.equal(run.calls, 0);
});

void test('a dataset that is not a list of rows refuses unspent too', async () => {
  const run = new CountedRun();
  await assert.rejects(
    evaluateAfterStrata(datasetFile('{"id": "a"}'), run.evaluate),
    /must be a list of rows/,
  );
  assert.equal(run.calls, 0);
});

void test('a pooled set still runs, carrying its warning', async () => {
  const run = new CountedRun();
  const started = await evaluateAfterStrata(
    canonicalDatasetPath('phase1c_selection_v1'),
    run.evaluate,
  );
  assert.deepEqual(started.strata.warnings, [pooledStratumWarning('phase1c_selection_v1')]);
  assert.equal(run.calls, 1);
});

/** A pooled interval nobody is told about is the defect in a quieter form. */
const POOLED = pooledStratumWarning('injection_g1_v1');
const pooledRun = await makeGatedRun(baselineParityScores(12));
const pooledResult = gateRunResultOf(pooledRun.report, {
  ...pooledRun.settings,
  strata: {},
  strataWarnings: [POOLED],
  baselineWarnings: ['a later warning'],
});

void test('the strata warning reaches the result file', () => {
  assert.ok(pooledResult.warnings.includes(POOLED));
});

void test('the strata warning comes first, where the load happened', () => {
  assert.equal(pooledResult.warnings[0], POOLED);
});
