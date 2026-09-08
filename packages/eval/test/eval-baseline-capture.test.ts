import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EVALUATOR_VERSION } from '../src/evaluators/agent-evaluator.ts';
import { baselinePath } from '../src/gate/baseline-store.ts';
import { unknownDatasetRefusal } from '../src/gate-run/baseline-candidate.ts';
import { baselineLocation } from '../src/gate-run/baseline-identity.ts';
import { GATED_DATASET } from './gated-run.ts';

/**
 * The capture command as the operator meets it (#1515): the real script in a
 * child process, its exit code, and its stderr.
 *
 * The refusals here are the ones no module can be asked for, because they are
 * about the command line rather than about a run — a missing `--result`, a flag
 * this command does not have — or because they are about a name that only a
 * committed file can carry. Each was a stack trace or nothing at all, and each
 * is asserted as ONE line, so a stack trace fails the assertion.
 *
 * test-type: unit (no network; every case refuses before anything is written).
 */

const SCRIPT = fileURLToPath(new URL('../scripts/eval-baseline-capture.ts', import.meta.url));

/** The standing record a refusal must leave exactly as it found it. */
const COMMITTED_BASELINE = baselinePath(baselineLocation());

function runCapture(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

/** A finished run's result file, complete enough to be a candidate, so that a
 * case below refuses for the one field it changed and for nothing else. */
const FINISHED_RUN = {
  generated_at: '2026-09-08T00:00:00.000Z',
  evaluator_version: EVALUATOR_VERSION,
  errored_count: 0,
  scores: {},
  case_scores: {},
  starved_cases: [],
  failures: [],
  metrics: [],
};

/** A directory outside the repo, removed when the test ends. */
function scratchDirectory(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'eval-baseline-capture-'));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

/** That run written there, naming a dataset and a case count. */
function resultFile(dataset: string, caseCount: number, directory: string): string {
  const path = join(directory, 'result.json');
  const run = { ...FINISHED_RUN, dataset, case_count: caseCount, evaluated_count: caseCount };
  writeFileSync(path, JSON.stringify(run));
  return path;
}

void test('no --result names the flag in one line and writes nothing', () => {
  const standing = readFileSync(COMMITTED_BASELINE, 'utf8');

  const run = runCapture([]);

  assert.equal(run.status, 1);
  assert.deepEqual(run.stderr.trimEnd().split('\n'), [
    'refusing to write a baseline: pass --result <results/<date>-<dataset>.json>, ' +
      'a run file `eval:gate` committed.',
  ]);
  assert.equal(readFileSync(COMMITTED_BASELINE, 'utf8'), standing);
});

/** `parseArgs` throws on a flag it has no option for. A typo is the likeliest
 * way to reach it, and a stack trace is the least useful answer to one. */
void test('a flag this command does not have refuses in one line', () => {
  const run = runCapture(['--reslt', 'results/2026-09-08-agent_eval_v3.json']);

  assert.equal(run.status, 1);
  assert.deepEqual(run.stderr.trimEnd().split('\n'), [
    'refusing to write a baseline: this command takes --result ' +
      '<results/<date>-<dataset>.json> and --replace, and nothing else. ' +
      'Check the spelling of what you passed.',
  ]);
});

/** A positional reaches the same refusal — this command takes none, which is
 * what the usage note's "NO `--` BEFORE THE FLAGS" is guarding against. */
void test('a positional argument refuses the same way, in one line', () => {
  const run = runCapture(['results/2026-09-08-agent_eval_v3.json']);

  assert.equal(run.status, 1);
  assert.equal(run.stderr.trimEnd().split('\n').length, 1);
});

/** The dataset name arrives from a committed FILE, long after anyone could
 * retype it, so it is answered with the list rather than thrown. */
void test('a result file naming a set nobody exports refuses in one line', (t) => {
  const path = resultFile('agent_eval_v4', 662, scratchDirectory(t));

  const run = runCapture(['--result', path]);

  assert.equal(run.status, 1);
  assert.deepEqual(run.stderr.trimEnd().split('\n'), [unknownDatasetRefusal('agent_eval_v4')]);
});

/** The same file naming an exported set gets past that check and is judged on
 * the run instead, every reason at once — proof the name is what the case above
 * measured, and that one refusal does not hide the next. */
void test('an exported set reaches the run refusals instead', (t) => {
  const path = resultFile(GATED_DATASET, 3, scratchDirectory(t));

  const run = runCapture(['--result', path]);

  assert.equal(run.status, 1);
  assert.deepEqual(run.stderr.trimEnd().split('\n'), [
    "refusing to write a baseline from a capped run: it set out to evaluate 3 of " +
      "agent_eval_v3's 662 cases, and a record describing a subset is stale for " +
      'every uncapped run after it. Re-run without --limit.',
    'refusing to overwrite the committed baseline: it is the floor every run ' +
      'is judged against today. Pass --replace to retire it.',
  ]);
});
