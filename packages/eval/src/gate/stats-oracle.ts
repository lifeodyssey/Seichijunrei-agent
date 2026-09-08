import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { BaselineRecord } from './baseline-record.ts';
import type { CaseScores } from './metric-gate.ts';
import type { Comparison, Interval } from './paired-bootstrap.ts';

/**
 * The Python side's own answers, for the TS port to be measured against.
 *
 * Written by `apps/agent/src/animichi/tests/eval/stats_oracle.py` — running
 * `stats.py` and `gate.py` themselves — and regenerated with:
 *
 *     cd apps/agent && uv run python -m animichi.tests.eval.stats_oracle \
 *       ../../packages/eval/fixtures/stats-oracle.json
 *
 * Keys stay snake_case because Python wrote them; only the accessor types here
 * are camelCase, the same split the dataset round trip settled on.
 */

export interface OracleComparison {
  readonly verdict: Comparison['verdict'];
  readonly estimate: number;
  readonly interval: Interval;
  readonly sample_size: number;
  readonly method: string;
}

export interface OraclePairedCase {
  readonly name: string;
  readonly pairs: readonly { baseline: number; current: number; stratum: string }[];
  readonly iterations: number;
  readonly comparison: OracleComparison;
}

export interface OracleClopperPearson {
  readonly events: number;
  readonly total: number;
  readonly confidence: number;
  readonly interval: Interval;
}

export interface OracleProportion {
  readonly current_events: number;
  readonly current_total: number;
  readonly baseline_events: number;
  readonly baseline_total: number;
  readonly comparison: OracleComparison;
}

export interface OracleGateCase {
  readonly name: string;
  readonly current_cases: CaseScores;
  readonly baseline: BaselineRecord;
  readonly strata: Readonly<Record<string, string>>;
  /** The run's starved case ids, sorted — empty for every row but
   * `starved_pairs` (`gate_oracle._starved_gate_case`). */
  readonly starved: readonly string[];
  readonly iterations: number;
  readonly min_paired: number;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
}

export interface OracleErrorRateCase {
  readonly name: string;
  readonly current_errored: number;
  readonly current_total: number;
  readonly baseline: BaselineRecord | null;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
}

/** One `provider_outage_failure` answer: the counts, the party the sentence
 * blames, the ceiling it was judged against, and Python's sentence.
 *
 * The ceiling is a column because Python has two of them and this runner has
 * one (`gate-run/provider-outage.ts`); each row publishes the one it was
 * written with, so both lanes replay here without this side claiming both. */
export interface OracleProviderOutageCase {
  readonly name: string;
  readonly starved: number;
  readonly evaluated: number;
  readonly answered_by: string;
  readonly ceiling: number;
  readonly failure: string | null;
}

export interface OracleStalenessCase {
  readonly name: string;
  readonly record: BaselineRecord;
  readonly expected_case_count: number | null;
  readonly expected_metrics: readonly string[] | null;
  readonly loaded: boolean;
  readonly warnings: readonly string[];
}

/** One `load_case_strata` answer: the mapping and warning, or the refusal. */
export interface OracleCaseStrata {
  readonly name: string;
  readonly dataset: string;
  readonly text: string;
  /** `null` when Python refused the dataset; `error` then carries the message. */
  readonly strata: Readonly<Record<string, string>> | null;
  readonly warnings: readonly string[];
  readonly error: string | null;
}

export interface OracleNumberText {
  readonly value: number;
  readonly text: string;
}

export interface StatsOracle {
  readonly number_text: {
    readonly fixed_4: readonly OracleNumberText[];
    readonly percent_0: readonly OracleNumberText[];
    readonly repr: readonly OracleNumberText[];
  };
  readonly random_stream: {
    readonly seed: number;
    readonly getrandbits_32: readonly number[];
    readonly choice_of_five: readonly string[];
    readonly choice_of_two: readonly string[];
    readonly choice_of_one: readonly string[];
  };
  readonly paired_comparisons: readonly OraclePairedCase[];
  readonly clopper_pearson_intervals: readonly OracleClopperPearson[];
  readonly proportion_comparisons: readonly OracleProportion[];
  readonly bootstrap_gates: readonly OracleGateCase[];
  readonly error_rate_gates: readonly OracleErrorRateCase[];
  readonly provider_outage_gates: readonly OracleProviderOutageCase[];
  readonly baseline_staleness: readonly OracleStalenessCase[];
  readonly case_strata: readonly OracleCaseStrata[];
  readonly baseline_paths: readonly { layer: string; model_id: string; filename: string }[];
  readonly written_records: readonly { readonly record: BaselineRecord; readonly text: string }[];
}

export const ORACLE_PATH = fileURLToPath(new URL('../../fixtures/stats-oracle.json', import.meta.url));

/** The baseline `agent_l4_trajectory` record, as Python wrote it (662 cases). */
export const PYTHON_BASELINES_DIR = fileURLToPath(new URL('../../baselines/', import.meta.url));
export const PYTHON_BASELINE_LAYER = 'agent_l4_trajectory';
/** Keep in step with `gate-run/python-baseline.ts` and `baseline_oracle.py`'s
 * `STALE_MODEL` — the oracle's warning strings interpolate the model name, so
 * three literals that disagree are three red tests. */
export const PYTHON_BASELINE_MODEL = 'openai:mimo-v2.5@https://api.xiaomimimo.com/v1';

export function readStatsOracle(): StatsOracle {
  return JSON.parse(readFileSync(ORACLE_PATH, 'utf8')) as StatsOracle;
}

export function oracleComparison(oracle: OracleComparison): Comparison {
  return {
    verdict: oracle.verdict,
    estimate: oracle.estimate,
    interval: oracle.interval,
    sampleSize: oracle.sample_size,
    method: oracle.method,
  };
}

/** The oracle entry a test names, or a loud failure if the fixture lost it. */
export function oracleEntryNamed<Entry extends { name: string }>(
  entries: readonly Entry[],
  name: string,
): Entry {
  const found = entries.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`stats-oracle.json has no entry named "${name}"`);
  }
  return found;
}

export function oracleEntryAt<Entry>(entries: readonly Entry[], index: number): Entry {
  const found = entries[index];
  if (found === undefined) {
    throw new Error(`stats-oracle.json has no entry at index ${String(index)}`);
  }
  return found;
}
