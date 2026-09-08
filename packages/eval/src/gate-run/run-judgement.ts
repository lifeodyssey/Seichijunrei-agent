/**
 * How a finished run is judged: as an outage, or against the baseline.
 *
 * Split out of `gate-run-result.ts` (#1496) because the ORDER of the two is a
 * decision with a name, not a line ordering inside a constructor — the same
 * reason `run_scores.py` is its own module on the Python side.
 */
import {
  errorRateGate,
  metricGateResults,
  type GateOutcome,
  type MetricGateResult,
} from '../gate/bootstrap-gate.ts';
import { aggregateScores, type ReportGateInput } from '../gate/report-gate-input.ts';
import type {
  AgentEvalReport,
  GateRunResult,
  GateRunSettings,
  MetricVerdictRow,
} from './gate-run-result.ts';
import { providerOutageGate } from './provider-outage.ts';

/** The four members a starved run and a judged one answer differently. */
type Judgement = Pick<GateRunResult, 'scores' | 'metrics' | 'failures' | 'warnings'>;

/**
 * The outage gate runs BEFORE the aggregation, and that order is the fix.
 *
 * `aggregateScores` is strict, and a starved run is exactly the report that
 * makes it throw: the transcript read of a crashed turn still publishes a
 * `steps` array — an empty one counts (`settled-params.ts::paramsRecordedIn`) —
 * so `runMetricNames` keeps `argument_correctness` in the run's own list while
 * `ArgumentCorrectness` scored nobody. Aggregating first threw
 * `Missing metric(s): argument_correctness` out of this function and the outage
 * sentence never reached the result — the 2026-09-08 nightly's failure mode,
 * rebuilt on this side by the gate meant to replace it (#1496).
 */
export function judgement(
  report: AgentEvalReport,
  settings: GateRunSettings,
  input: ReportGateInput,
): Judgement {
  const outage = providerOutageGate(report);
  return outage.length > 0
    ? starvedJudgement(outage, settings)
    : comparedJudgement(report, settings, input);
}

/**
 * A starved run is reported, never compared. Its columns measure the outage
 * rather than the agent, so `scores` is empty on purpose: publishing the seven
 * a crashed turn still emits would put numbers in the result file that a reader
 * — and #1303's comparison — could mistake for a measurement of the agent.
 */
function starvedJudgement(outage: readonly string[], settings: GateRunSettings): Judgement {
  return {
    scores: {},
    metrics: [],
    failures: [...outage, ...settings.baselineFailures],
    warnings: [...settings.strataWarnings, ...settings.baselineWarnings],
  };
}

function comparedJudgement(
  report: AgentEvalReport,
  settings: GateRunSettings,
  input: ReportGateInput,
): Judgement {
  const scores = aggregateScores(report, settings.metricNames);
  const metrics = comparedMetrics(input.cases, settings);
  const errors = errorRateGate(input.erroredCount, input.total, settings.baseline);
  return { scores, metrics: metrics.map(verdictRow), ...gateOutcome(metrics, errors, settings) };
}

/** No baseline is no comparison — never an empty one that would read as "pass". */
function comparedMetrics(
  cases: ReportGateInput['cases'],
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
 *
 * The outage gate is not in this list: it short-circuits `judgement` above, so
 * a run that reaches here is one the deploy actually answered (#1496).
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
      ...settings.strataWarnings,
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
