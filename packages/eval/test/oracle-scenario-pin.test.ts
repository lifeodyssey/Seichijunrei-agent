import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readStatsOracle } from '../src/gate/stats-oracle.ts';
import { ORACLE } from './evaluator-oracle.ts';
import {
  EVALUATOR_ORACLE_SCENARIOS,
  STATS_ORACLE_ROW_COUNTS,
  STATS_ORACLE_SCENARIOS,
  type StatsOracleList,
  type StatsOracleRowList,
} from './expected-oracle-scenarios.ts';

/**
 * The two oracles generate one test per entry, so a scenario dropped from its
 * Python producer removes its own test instead of failing one. These
 * set-difference assertions are the pin: they read the committed id list, not
 * the fixture, and name the id that went missing.
 */
interface ScenarioDrift {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
}

const NO_DRIFT: ScenarioDrift = { missing: [], extra: [] };

/** Which pinned ids the fixture lost, and which ids it grew unpinned. */
function driftOf(pinned: readonly string[], found: readonly string[]): ScenarioDrift {
  const foundIds = new Set(found);
  const pinnedIds = new Set(pinned);
  return {
    missing: pinned.filter((id) => !foundIds.has(id)),
    extra: found.filter((id) => !pinnedIds.has(id)),
  };
}

const statsOracle = readStatsOracle();

type NamedCases = readonly { readonly name: string }[];

const STATS_ORACLE_CASES: readonly (readonly [StatsOracleList, NamedCases])[] = [
  ['baseline_staleness', statsOracle.baseline_staleness],
  ['bootstrap_gates', statsOracle.bootstrap_gates],
  ['case_strata', statsOracle.case_strata],
  ['error_rate_gates', statsOracle.error_rate_gates],
  ['paired_comparisons', statsOracle.paired_comparisons],
  ['provider_outage_gates', statsOracle.provider_outage_gates],
];

const STATS_ORACLE_ROWS: Readonly<Record<StatsOracleRowList, number>> = {
  baseline_paths: statsOracle.baseline_paths.length,
  clopper_pearson_intervals: statsOracle.clopper_pearson_intervals.length,
  'number_text.fixed_4': statsOracle.number_text.fixed_4.length,
  'number_text.percent_0': statsOracle.number_text.percent_0.length,
  'number_text.repr': statsOracle.number_text.repr.length,
  proportion_comparisons: statsOracle.proportion_comparisons.length,
  'random_stream.choice_of_five': statsOracle.random_stream.choice_of_five.length,
  'random_stream.choice_of_one': statsOracle.random_stream.choice_of_one.length,
  'random_stream.choice_of_two': statsOracle.random_stream.choice_of_two.length,
  'random_stream.getrandbits_32': statsOracle.random_stream.getrandbits_32.length,
  written_records: statsOracle.written_records.length,
};

void test('the evaluator oracle carries exactly the pinned scenarios', () => {
  const found = ORACLE.cases.map((entry) => entry.caseId);
  assert.deepEqual(driftOf(EVALUATOR_ORACLE_SCENARIOS, found), NO_DRIFT);
});

for (const [list, cases] of STATS_ORACLE_CASES) {
  void test(`the stats oracle's ${list} carries exactly the pinned scenarios`, () => {
    const found = cases.map((entry) => entry.name);
    assert.deepEqual(driftOf(STATS_ORACLE_SCENARIOS[list], found), NO_DRIFT);
  });
}

void test('the stats oracle keeps every pinned anonymous row', () => {
  assert.deepEqual(STATS_ORACLE_ROWS, STATS_ORACLE_ROW_COUNTS);
});

void test('every pinned named list is one this file actually reads', () => {
  const read = STATS_ORACLE_CASES.map(([list]) => list);
  assert.deepEqual([...read].sort(), Object.keys(STATS_ORACLE_SCENARIOS).sort());
});
