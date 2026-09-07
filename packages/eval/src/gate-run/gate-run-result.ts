import type { EvaluationReport } from 'logfire/evals';

import type { ExportedAgentExpected, ExportedAgentInput } from '../dataset-roundtrip.ts';
import type { BaselineRecord } from '../gate/baseline-record.ts';
import {
  DEFAULT_MIN_PAIRED,
  errorRateGate,
  metricGateResults,
  type GateOutcome,
  type MetricGateResult,
} from '../gate/bootstrap-gate.ts';
import { DEFAULT_PROPORTION_MIN_EFFECT } from '../gate/clopper-pearson.ts';
import {
  DEFAULT_CONFIDENCE,
  DEFAULT_ITERATIONS,
  DEFAULT_PAIRED_MIN_EFFECT,
  DEFAULT_SEED,
  type Interval,
  type Verdict,
} from '../gate/paired-bootstrap.ts';
import { aggregateScores, gateInputFromReport } from '../gate/report-gate-input.ts';
import type { TranscriptResult } from '../turn-transcript.ts';
import { attributionEvidenceRef } from './attribution-evidence.ts';
import {
  analyseFailures,
  attributionRecordOf,
  type RunFailureAttribution,
} from './failure-attribution.ts';
import { reportOnlyMetricsOf, type ReportOnlyMetrics } from './report-only-metrics.ts';
import { scoreBreakdownOf, type ScoreBreakdown } from './score-breakdown.ts';
import { runSpendOf, type RunSpend } from './run-spend.ts';

/**
 * One gate run, written down (W3-5 #1303 via #1327).
 *
 * This is `run_agent_eval.py`'s ending, as a record rather than as printed
 * lines: the scores it prints, the gate verdict it exits on, and the settings
 * that produced them. Python could get away with printing because the run and
 * the reader were the same person at the same terminal; the W3 exit is a
 * comparison someone signs off later, so the numbers, the seed and the
 * intervals have to survive the session.
 *
 * FIELD NAMES ARE snake_case, for the same reason `baseline-record.ts`'s are:
 * this is the file's own shape, it sits next to Python-written records, and a
 * camelCase mirror would only be a mapping layer to get wrong.
 *
 * WHAT IT DOES NOT DO IS WRITE A BASELINE. Python's uncapped run creates one
 * when none is found (`_run_uncapped_gate`); this runner never does. The whole
 * point of the double run is to compare against the Python numbers, and a
 * runner that could write the record it is judged by is a runner that can make
 * itself pass — the failure mode `apps/agent/AGENTS.md` names as "never refresh
 * a baseline merely to pass a gate".
 */

/** The report one staging run produces: exported cases in, wire transcripts out. */
export type AgentEvalReport = EvaluationReport<
  ExportedAgentInput,
  TranscriptResult,
  ExportedAgentExpected
>;

/** A metric's three-way verdict, plus the fourth answer a gate can give: there
 * were too few paired cases to compare it at all. */
export type MetricGateVerdict = Verdict | 'skipped';

/** One metric's row: what the gate decided and the evidence it decided on. */
export interface MetricVerdictRow {
  readonly metric: string;
  readonly verdict: MetricGateVerdict;
  /** `baseline - current`; `null` for a skipped metric, which has no estimate. */
  readonly mean_delta: number | null;
  readonly interval: Interval | null;
  readonly sample_size: number;
  readonly method: string | null;
}

/** Everything the caller knows that the report itself does not. */
export interface GateRunSettings {
  readonly dataset: string;
  /** The cases the run set out to evaluate, errored ones included. */
  readonly caseCount: number;
  /** `metric_names()` for this dataset — the metrics `scores` must carry. */
  readonly metricNames: readonly string[];
  /** `null` when no usable baseline was found; the two lists below say why. */
  readonly baseline: BaselineRecord | null;
  readonly baselineModel: string;
  /** The blocking half of the read: a committed record that no longer parses.
   * An ungated run is a warning; a damaged baseline is a red result. */
  readonly baselineFailures: readonly string[];
  readonly baselineWarnings: readonly string[];
  /** Case id → behaviour path, from the canonical dataset (`case-strata.ts`). */
  readonly strata: Readonly<Record<string, string>>;
  /** Injected so a test can pin the date the result file is named for. */
  readonly now: () => Date;
}

export interface GateRunResult {
  readonly schema_version: 1;
  readonly generated_at: string;
  readonly dataset: string;
  readonly baseline_model: string;
  readonly seed: number;
  readonly iterations: number;
  readonly confidence: number;
  readonly min_effect: number;
  readonly proportion_min_effect: number;
  readonly min_paired: number;
  readonly case_count: number;
  readonly evaluated_count: number;
  readonly errored_count: number;
  readonly scores: Readonly<Record<string, number>>;
  /** The columns that are reported and NOT gated (`report-only-metrics.ts`).
   * Its own field rather than a ninth entry in `scores`, because `scores` is
   * positionally aligned with the Python baseline. */
  readonly report_only: ReportOnlyMetrics;
  /** Where each FAILED case first left the rails (E-4 #1383,
   * `failure-attribution.ts`). Report-only by the same mechanism `report_only`
   * is: computed over the finished report, outside `scores`, outside
   * `metricNames()`, and read by no gate. Its own field rather than a key in
   * `report_only`, which is typed as metric columns. */
  readonly failure_attribution: RunFailureAttribution;
  readonly metrics: readonly MetricVerdictRow[];
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
  readonly breakdown: ScoreBreakdown;
  readonly spend: RunSpend;
}

export function gateRunResultOf(
  report: AgentEvalReport,
  settings: GateRunSettings,
): GateRunResult {
  const scores = aggregateScores(report, settings.metricNames);
  const input = gateInputFromReport(report);
  const metrics = comparedMetrics(input.cases, settings);
  const errors = errorRateGate(input.erroredCount, input.total, settings.baseline);
  const identity = runIdentity(settings);
  return {
    ...identity,
    ...pinnedGateSettings(),
    case_count: settings.caseCount,
    evaluated_count: input.evaluatedCount,
    errored_count: input.erroredCount,
    scores,
    report_only: reportOnlyMetricsOf(report),
    failure_attribution: attributionRecordOf(
      analyseFailures(report),
      attributionEvidenceRef(identity.generated_at, identity.dataset),
    ),
    metrics: metrics.map(verdictRow),
    ...gateOutcome(metrics, errors, settings),
    breakdown: scoreBreakdownOf(report),
    spend: runSpendOf(report),
  };
}

function runIdentity(
  settings: GateRunSettings,
): Pick<GateRunResult, 'schema_version' | 'generated_at' | 'dataset' | 'baseline_model'> {
  return {
    schema_version: 1,
    generated_at: settings.now().toISOString(),
    dataset: settings.dataset,
    baseline_model: settings.baselineModel,
  };
}

/**
 * The statistics the verdict was reached with, recorded because a gate result
 * without them cannot be re-run. They are `stats.py`'s defaults and this
 * runner does not expose a flag for any of them: a seed or an iteration count
 * that moves per run is a seed that can be searched until the gate is green.
 */
function pinnedGateSettings(): Pick<
  GateRunResult,
  'seed' | 'iterations' | 'confidence' | 'min_effect' | 'proportion_min_effect' | 'min_paired'
> {
  return {
    seed: DEFAULT_SEED,
    iterations: DEFAULT_ITERATIONS,
    confidence: DEFAULT_CONFIDENCE,
    min_effect: DEFAULT_PAIRED_MIN_EFFECT,
    proportion_min_effect: DEFAULT_PROPORTION_MIN_EFFECT,
    min_paired: DEFAULT_MIN_PAIRED,
  };
}

/** No baseline is no comparison — never an empty one that would read as "pass". */
function comparedMetrics(
  cases: ReturnType<typeof gateInputFromReport>['cases'],
  settings: GateRunSettings,
): readonly MetricGateResult[] {
  if (settings.baseline === null) {
    return [];
  }
  return metricGateResults(cases, settings.baseline, { strata: settings.strata });
}

/**
 * `_gate_failures`' order, minus the direct thrash gate: Python's per-case
 * request counts come from `AgentResult.usage`, which the wire does not carry
 * (see `run-spend.ts`). Both lists lead with the baseline read, which is where
 * Python logs its own — and, for the one baseline problem this side blocks on,
 * where the red comes from (`baseline-store.ts`).
 */
function gateOutcome(
  metrics: readonly MetricGateResult[],
  errors: GateOutcome,
  settings: GateRunSettings,
): Pick<GateRunResult, 'failures' | 'warnings'> {
  return {
    failures: [
      ...settings.baselineFailures,
      ...metrics.flatMap((row) => row.outcome.failures),
      ...errors.failures,
    ],
    warnings: [
      ...settings.baselineWarnings,
      ...metrics.flatMap((row) => row.outcome.warnings),
      ...errors.warnings,
    ],
  };
}

function verdictRow(result: MetricGateResult): MetricVerdictRow {
  const { comparison } = result;
  if (comparison === null) {
    return skippedRow(result.metric, result.pairedCases);
  }
  return {
    metric: result.metric,
    verdict: comparison.verdict,
    mean_delta: comparison.estimate,
    interval: comparison.interval,
    sample_size: comparison.sampleSize,
    method: comparison.method,
  };
}

function skippedRow(metric: string, pairedCases: number): MetricVerdictRow {
  return {
    metric,
    verdict: 'skipped',
    mean_delta: null,
    interval: null,
    sample_size: pairedCases,
    method: null,
  };
}
