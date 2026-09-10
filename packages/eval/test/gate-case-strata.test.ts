import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  canonicalDatasetPath,
  caseStrataFromText,
  loadCaseStrata,
  pooledStratumWarning,
} from '../src/gate/case-strata.ts';
import { oracleEntryNamed, readStatsOracle } from '../src/gate/stats-oracle.ts';
import { fixturePath } from '../src/dataset-roundtrip.ts';

const strata = loadCaseStrata(canonicalDatasetPath('agent_eval_v3'));
const oracle = readStatsOracle().case_strata;

void test('every canonical case carries a behaviour path', () => {
  assert.equal(Object.keys(strata.byCase).length, 662);
});

void test('a stratified dataset warns about nothing', () => {
  assert.deepEqual(strata.warnings, []);
});

void test('a known case keeps its behaviour family', () => {
  assert.equal(strata.byCase.A1_ja_001, 'exact_db_api_ok');
});

void test('the 662 cases spread over the behaviour families the gate stratifies by', () => {
  assert.equal(new Set(Object.values(strata.byCase)).size, 66);
});

void test('the exported dataset carries no path, so the strata cannot come from it', () => {
  const exported = readFileSync(fixturePath('agent_eval_v3'), 'utf8');
  assert.equal(exported.includes('"path"'), false);
});

/**
 * #1478: every canonical set with no `path` column. A run over the sets crashed
 * on the first three; the other two would have crashed next.
 */
const POOLED_SETS = [
  'injection_g1_v1',
  'input_guard_v1',
  'phase1c_selection_v1',
  'runtime_journey_v1',
  'translation_v1',
];

for (const setName of POOLED_SETS) {
  void test(`${setName}: no path column, so one stratum`, () => {
    const pooled = loadCaseStrata(canonicalDatasetPath(setName));
    assert.deepEqual([...new Set(Object.values(pooled.byCase))], ['unstratified']);
  });

  void test(`${setName}: says so, naming the dataset and the pooled interval`, () => {
    const pooled = loadCaseStrata(canonicalDatasetPath(setName));
    assert.deepEqual(pooled.warnings, [pooledStratumWarning(setName)]);
  });
}

void test('a row without an id is refused, pooled or not', () => {
  assert.throws(
    () => caseStrataFromText('[{"id": "a"}, {}]', 'set'),
    /set: row 1 has no string "id"/,
  );
});

void test('a dataset that is not a list of rows is refused', () => {
  assert.throws(() => loadCaseStrata(fixturePath('agent_eval_v3')), /must be a list of rows/);
});

/** A bare `SyntaxError` names no set, and Python's `JSONDecodeError` words it
 * differently — neither is traceable nor comparable across the two runners. */
void test('a dataset that is not JSON is refused by name', () => {
  assert.throws(() => caseStrataFromText('[{"id": "a", "path": "p"},', 'set'), {
    message: 'set: invalid JSON',
  });
});

void test('the unparseable dataset keeps the parse error as its cause', () => {
  assert.throws(() => caseStrataFromText('nonsense', 'set'), (error: unknown) => {
    assert.ok(error instanceof TypeError);
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

/** Parity: every answer below is Python's own, via `strata_oracle.py`. */
for (const entry of oracle.filter((one) => one.strata !== null)) {
  void test(`${entry.name}: the same strata Python loads`, () => {
    assert.deepEqual(caseStrataFromText(entry.text, entry.dataset), {
      byCase: entry.strata,
      warnings: entry.warnings,
    });
  });
}

for (const entry of oracle.filter((one) => one.strata === null)) {
  void test(`${entry.name}: refused with the message Python raises`, () => {
    assert.throws(() => caseStrataFromText(entry.text, entry.dataset), {
      message: String(entry.error),
    });
  });
}

void test('the oracle pins both a pooled set and a refused one', () => {
  assert.equal(oracleEntryNamed(oracle, 'no_path_column').warnings.length, 1);
  assert.notEqual(oracleEntryNamed(oracle, 'partial_path_column').error, null);
});
