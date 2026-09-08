import { averages } from 'logfire/evals';
import type { EvaluationReport, ReportCase } from 'logfire/evals';

import type { CaseScores } from './metric-gate.ts';

/**
 * What the gates need out of a finished `logfire/evals` report — the TS side of
 * `eval_gate_flow._report_gate_input` and `exec_tiers.collect_case_scores`.
 *
 * `report.failures` is the single source of truth for errored cases, exactly as
 * Python treats its classified errors, and the error gate's denominator is
 * evaluated + errored rather than the dataset size: a case that never ran
 * cannot be scored, but it did error.
 *
 * Assertions are folded in beside scores as 1 and 0. Python's evaluators all
 * return floats, so on that side the fold is a no-op; a TS evaluator that
 * returns a boolean lands in `assertions`, and dropping it would silently
 * remove a metric the baseline still expects.
 */

export interface ReportGateInput {
  readonly cases: CaseScores;
  readonly evaluatedCount: number;
  readonly erroredCount: number;
  readonly total: number;
}

export function gateInputFromReport(report: EvaluationReport): ReportGateInput {
  const evaluatedCount = report.cases.length;
  const erroredCount = report.failures.length;
  return {
    cases: caseScoresFromReport(report),
    evaluatedCount,
    erroredCount,
    total: evaluatedCount + erroredCount,
  };
}

export function caseScoresFromReport(report: EvaluationReport): CaseScores {
  return Object.fromEntries(report.cases.map((entry) => [entry.name, caseScores(entry)]));
}

/** `_scores` + `collect_scores`: the named metric averages, or a named failure. */
export function aggregateScores(
  report: EvaluationReport,
  metricNames: readonly string[],
): Record<string, number> {
  const scored = averages(report)?.scores;
  if (scored === undefined) {
    throw new Error('All cases errored — check model endpoint and DB.');
  }
  const missing = metricNames.filter((name) => !(name in scored));
  if (missing.length > 0) {
    throw new Error(`Missing metric(s): ${missing.join(', ')}. Available: ${availableNames(scored)}`);
  }
  return Object.fromEntries(metricNames.map((name) => [name, scored[name]?.mean ?? 0]));
}

function availableNames(scored: Readonly<Record<string, { mean: number }>>): string {
  const names = Object.keys(scored).sort();
  return names.length === 0 ? '<none>' : names.join(', ');
}

function caseScores(entry: ReportCase): Record<string, number> {
  const scored = Object.entries(entry.scores).map(([name, result]) => [name, numeric(result.value)]);
  const asserted = Object.entries(entry.assertions).map(([name, result]) => [
    name,
    numeric(result.value),
  ]);
  return Object.fromEntries([...scored, ...asserted]) as Record<string, number>;
}

/** `float(value)` — booleans are 1 and 0, numeric strings are parsed. */
function numeric(value: boolean | number | string): number {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Score is not numeric: ${JSON.stringify(value)}`);
  }
  return parsed;
}
