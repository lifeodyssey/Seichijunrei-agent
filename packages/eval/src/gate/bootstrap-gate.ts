import type { BaselineRecord } from './baseline-record.ts';
import {
  DEFAULT_PROPORTION_MIN_EFFECT,
  proportionComparison,
} from './clopper-pearson.ts';
import {
  comparisonOutcome,
  metricGateResults,
  type BootstrapGateOptions,
  type CaseScores,
  type GateOutcome,
} from './metric-gate.ts';
import { DEFAULT_CONFIDENCE } from './paired-bootstrap.ts';
import { pythonPercentText } from './python-number-text.ts';

/**
 * `gate.py`'s two gates over a finished run.
 *
 * `bootstrapGate` is the fold of `metric-gate.ts`'s per-metric rows — that
 * module owns what a metric's verdict IS and this one owns running it over the
 * whole baseline, the same split `gate.py` and `metric_gate.py` keep. The error
 * gate is here because it is the other thing a caller runs over a finished run,
 * and it reads the metric module's `comparisonOutcome` for its own verdict.
 *
 * Only a `fail` verdict blocks. `indeterminate` is reported and waved through:
 * a gate that blocked on "not enough evidence" would block on noise.
 */

export interface ErrorRateGateOptions {
  readonly confidence?: number;
  readonly minEffect?: number;
}

/** Above this share of errored cases the run is broken, baseline or not. */
export const ERROR_RATE_CEILING = 0.2;

export function bootstrapGate(
  currentCases: CaseScores,
  baseline: BaselineRecord,
  options: BootstrapGateOptions = {},
): GateOutcome {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const result of metricGateResults(currentCases, baseline, options)) {
    collect(result.outcome, failures, warnings);
  }
  return { failures, warnings };
}

export function errorRateGate(
  currentErrored: number,
  currentTotal: number,
  baseline: BaselineRecord | null,
  options: ErrorRateGateOptions = {},
): GateOutcome {
  const ceiling = absoluteErrorRateFailure(currentErrored, currentTotal);
  if (ceiling !== null) {
    return { failures: [ceiling], warnings: [] };
  }
  if (baseline === null) {
    return { failures: [], warnings: [] };
  }
  return baselineErrorRate(currentErrored, currentTotal, baseline, options);
}

function baselineErrorRate(
  currentErrored: number,
  currentTotal: number,
  baseline: BaselineRecord,
  options: ErrorRateGateOptions,
): GateOutcome {
  const baselineTotal = baseline.evaluated_count + baseline.errored_count;
  if (currentTotal <= 0 || baselineTotal <= 0) {
    return { failures: [], warnings: ['Skipping error_rate: zero total cases'] };
  }
  const comparison = proportionComparison(
    currentErrored,
    currentTotal,
    baseline.errored_count,
    baselineTotal,
    {
      confidence: options.confidence ?? DEFAULT_CONFIDENCE,
      minEffect: options.minEffect ?? DEFAULT_PROPORTION_MIN_EFFECT,
    },
  );
  return comparisonOutcome('error_rate', comparison);
}

/** Fail uncapped runs when more than 20% of cases error, baseline-independent. */
function absoluteErrorRateFailure(errored: number, total: number): string | null {
  const rate = total > 0 ? errored / total : 1;
  if (rate <= ERROR_RATE_CEILING) {
    return null;
  }
  const counted = `${String(errored)}/${String(total)}`;
  return `${counted} cases errored (${pythonPercentText(rate)}). Check API key and model endpoint.`;
}

function collect(outcome: GateOutcome, failures: string[], warnings: string[]): void {
  failures.push(...outcome.failures);
  warnings.push(...outcome.warnings);
}
