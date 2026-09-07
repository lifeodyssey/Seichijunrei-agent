import { type BaselineRecord, caseMetrics } from './baseline-record.ts';
import {
  DEFAULT_PROPORTION_MIN_EFFECT,
  proportionComparison,
} from './clopper-pearson.ts';
import {
  DEFAULT_CONFIDENCE,
  DEFAULT_ITERATIONS,
  DEFAULT_PAIRED_MIN_EFFECT,
  DEFAULT_SEED,
  UNSTRATIFIED,
  stratifiedPairedComparison,
  type Comparison,
  type PairedScore,
} from './paired-bootstrap.ts';
import { pythonFixedText, pythonPercentText } from './python-number-text.ts';

/**
 * `gate.py`'s two gates over a finished run.
 *
 * Python surfaces the non-blocking half of the verdict through the `logging`
 * module; a Node runner has no such ambient sink, so both gates return their
 * warnings next to their failures. The strings are the Python ones verbatim —
 * an eval run's output should read the same whichever runner produced it.
 *
 * Only a `fail` verdict blocks. `indeterminate` is reported and waved through:
 * a gate that blocked on "not enough evidence" would block on noise.
 */

export type CaseScores = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface GateOutcome {
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
}

export interface BootstrapGateOptions {
  readonly iterations?: number;
  readonly confidence?: number;
  readonly seed?: number;
  readonly minEffect?: number;
  readonly minPaired?: number;
  readonly strata?: Readonly<Record<string, string>>;
}

export interface ErrorRateGateOptions {
  readonly confidence?: number;
  readonly minEffect?: number;
}

export const DEFAULT_MIN_PAIRED = 10;
/** Above this share of errored cases the run is broken, baseline or not. */
export const ERROR_RATE_CEILING = 0.2;

/**
 * One metric's place in the gate: the comparison it produced, and the strings
 * that comparison is reported as.
 *
 * `bootstrapGate` is the fold of these. A caller that has to WRITE a verdict
 * down rather than print it — W3-5's result file — reads the rows instead of
 * deriving a second comparison from the same pairs, which would be a second
 * seed, a second interval, and eventually a second answer.
 */
export interface MetricGateResult {
  readonly metric: string;
  /** How many cases carry this metric on both sides. */
  readonly pairedCases: number;
  /** `null` when there were too few pairs to compare at all. */
  readonly comparison: Comparison | null;
  readonly outcome: GateOutcome;
}

export function metricGateResults(
  currentCases: CaseScores,
  baseline: BaselineRecord,
  options: BootstrapGateOptions = {},
): MetricGateResult[] {
  return baselineMetrics(baseline).map((metric) =>
    metricGateResult(metric, currentCases, baseline, options),
  );
}

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

function metricGateResult(
  metric: string,
  currentCases: CaseScores,
  baseline: BaselineRecord,
  options: BootstrapGateOptions,
): MetricGateResult {
  const minPaired = options.minPaired ?? DEFAULT_MIN_PAIRED;
  const pairs = pairedScores(metric, currentCases, baseline, options.strata ?? {});
  const pairedCases = pairs.length;
  if (pairedCases < minPaired) {
    return { metric, pairedCases, comparison: null, outcome: skipped(metric, pairedCases, minPaired) };
  }
  const comparison = pairedComparison(pairs, options);
  return { metric, pairedCases, comparison, outcome: comparisonOutcome(metric, comparison) };
}

function skipped(metric: string, paired: number, minPaired: number): GateOutcome {
  return { failures: [], warnings: [fewPairsWarning(metric, paired, minPaired)] };
}

function pairedComparison(
  pairs: readonly PairedScore[],
  options: BootstrapGateOptions,
): Comparison {
  return stratifiedPairedComparison(pairs, {
    iterations: options.iterations ?? DEFAULT_ITERATIONS,
    confidence: options.confidence ?? DEFAULT_CONFIDENCE,
    seed: options.seed ?? DEFAULT_SEED,
    minEffect: options.minEffect ?? DEFAULT_PAIRED_MIN_EFFECT,
  });
}

function pairedScores(
  metric: string,
  currentCases: CaseScores,
  baseline: BaselineRecord,
  strata: Readonly<Record<string, string>>,
): PairedScore[] {
  const shared = Object.keys(baseline.cases)
    .filter((caseId) => caseId in currentCases)
    .sort();
  return shared
    .map((caseId) => pairedScore(metric, caseId, currentCases, baseline, strata))
    .filter((pair) => pair !== null);
}

function pairedScore(
  metric: string,
  caseId: string,
  currentCases: CaseScores,
  baseline: BaselineRecord,
  strata: Readonly<Record<string, string>>,
): PairedScore | null {
  const baselineScore = baseline.cases[caseId]?.[metric];
  const currentScore = currentCases[caseId]?.[metric];
  if (baselineScore === undefined || currentScore === undefined) {
    return null;
  }
  return {
    baseline: baselineScore,
    current: currentScore,
    stratum: strata[caseId] ?? UNSTRATIFIED,
  };
}

/** Every metric the baseline knows about, aggregate and per-case alike. */
function baselineMetrics(baseline: BaselineRecord): string[] {
  return [...new Set([...caseMetrics(baseline), ...Object.keys(baseline.scores)])].sort();
}

function comparisonOutcome(metric: string, comparison: Comparison): GateOutcome {
  const message = formatComparison(metric, comparison);
  if (comparison.verdict === 'pass') {
    return { failures: [], warnings: [] };
  }
  if (comparison.verdict === 'indeterminate') {
    return { failures: [], warnings: [`INDETERMINATE ${message}`] };
  }
  return { failures: [message], warnings: [] };
}

function formatComparison(metric: string, comparison: Comparison): string {
  const delta = pythonFixedText(comparison.estimate, 4);
  const lower = pythonFixedText(comparison.interval.lower, 4);
  const upper = pythonFixedText(comparison.interval.upper, 4);
  const size = String(comparison.sampleSize);
  return `${metric}: mean_delta=${delta}, ci=[${lower}, ${upper}], n=${size}, method=${comparison.method}`;
}

function fewPairsWarning(metric: string, paired: number, minPaired: number): string {
  return `Skipping ${metric}: only ${String(paired)} paired cases, need ${String(minPaired)}`;
}
