import { type BaselineRecord, caseMetrics } from './baseline-record.ts';
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
import { pythonFixedText } from './python-number-text.ts';

/**
 * One baseline metric, compared against this run — and why it might not be.
 *
 * `metric_gate.py`'s twin, split out of `bootstrap-gate.ts` for the reason it
 * was split out of `gate.py` (#1499): the file was over the 300-line cap, and
 * the decision this one owns needed the room. `pairedScores` drops every shared
 * case that does not carry the metric, so a run the provider starved arrives
 * here as a metric with too few pairs — and "too few pairs" used to have one
 * answer, a warning about a small sample. It has two, and `fewPairs` below is
 * the one place that tells them apart.
 *
 * Python surfaces the non-blocking half of a verdict through `logging`; a Node
 * runner has no such ambient sink, so every answer here is a `GateOutcome` with
 * its warnings next to its failures. The strings are the Python ones verbatim —
 * an eval run's output should read the same whichever runner produced it.
 *
 * `comparisonOutcome` is exported rather than private because `errorRateGate`
 * reads it back out, exactly as `gate.py` imports `comparison_failure` from
 * `metric_gate.py`. That is also the import direction: `bootstrap-gate.ts`
 * folds what this module decides, never the other way round.
 */

export type CaseScores = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface GateOutcome {
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
}

/** Named for the fold in `bootstrap-gate.ts`, whose signature it is (as
 * `bootstrap_gate`'s keyword arguments are `metric_gate.GateOptions`). */
export interface BootstrapGateOptions {
  readonly iterations?: number;
  readonly confidence?: number;
  readonly seed?: number;
  readonly minEffect?: number;
  readonly minPaired?: number;
  readonly strata?: Readonly<Record<string, string>>;
  /** The run's starved cases (`provider-outage.ts::starvedCaseIdsOf`), which
   * decide whether a metric with too few pairs is skipped or failed below. */
  readonly starved?: ReadonlySet<string>;
}

export const DEFAULT_MIN_PAIRED = 10;

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

/** Only a `fail` verdict blocks. `indeterminate` is reported and waved through:
 * a gate that blocked on "not enough evidence" would block on noise. */
export function comparisonOutcome(metric: string, comparison: Comparison): GateOutcome {
  const message = formatComparison(metric, comparison);
  if (comparison.verdict === 'pass') {
    return { failures: [], warnings: [] };
  }
  if (comparison.verdict === 'indeterminate') {
    return { failures: [], warnings: [`INDETERMINATE ${message}`] };
  }
  return { failures: [message], warnings: [] };
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
    const starved = starvedMissingPairs(metric, currentCases, baseline, options.starved);
    const outcome = fewPairs(metric, pairedCases, minPaired, starved);
    return { metric, pairedCases, comparison: null, outcome };
  }
  const comparison = pairedComparison(pairs, options);
  return { metric, pairedCases, comparison, outcome: comparisonOutcome(metric, comparison) };
}

/**
 * `metric_gate._few_pairs`: too few pairs has two causes and one of them
 * blocks (#1499).
 *
 * A sample that was always small is noise, and a gate that failed on noise
 * would fail on every short run. A sample STARVATION emptied is a column this
 * run cannot prove, and skipping it walks the outage past the gate #1496 put in
 * front of it — a run under Python's baseline-lane ceiling is judgeable and
 * still carries enough boundary answers to empty one metric.
 */
function fewPairs(
  metric: string,
  paired: number,
  minPaired: number,
  starved: number,
): GateOutcome {
  if (starved === 0) {
    return { failures: [], warnings: [fewPairsWarning(metric, paired, minPaired)] };
  }
  return { failures: [starvedPairsFailure(metric, paired, minPaired, starved)], warnings: [] };
}

/** The shared cases this metric lost that the provider never answered. A case
 * the baseline has no row for could not have paired anyway. */
function starvedMissingPairs(
  metric: string,
  currentCases: CaseScores,
  baseline: BaselineRecord,
  starved: ReadonlySet<string> | undefined,
): number {
  if (starved === undefined) {
    return 0;
  }
  return sharedCases(currentCases, baseline).filter(
    (caseId) => starved.has(caseId) && !hasMetric(metric, caseId, currentCases, baseline),
  ).length;
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
  return sharedCases(currentCases, baseline)
    .map((caseId) => pairedScore(metric, caseId, currentCases, baseline, strata))
    .filter((pair) => pair !== null);
}

/** `metric_gate._shared_cases`: the case ids both sides carry, sorted. */
function sharedCases(currentCases: CaseScores, baseline: BaselineRecord): string[] {
  return Object.keys(baseline.cases)
    .filter((caseId) => caseId in currentCases)
    .sort();
}

function hasMetric(
  metric: string,
  caseId: string,
  currentCases: CaseScores,
  baseline: BaselineRecord,
): boolean {
  return (
    baseline.cases[caseId]?.[metric] !== undefined &&
    currentCases[caseId]?.[metric] !== undefined
  );
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

/**
 * How every comparison sentence — a regression failure and an INDETERMINATE
 * warning alike — begins. One literal, because `gate-run/baseline-capture.ts`
 * has to tell a metric regressing against the baseline from every other red a
 * run can carry, and a second copy of this prefix would be a recogniser that
 * drifts silently away from the sentence it recognises (#1515).
 */
export function comparisonSentencePrefix(metric: string): string {
  return `${metric}: mean_delta=`;
}

function formatComparison(metric: string, comparison: Comparison): string {
  const delta = pythonFixedText(comparison.estimate, 4);
  const lower = pythonFixedText(comparison.interval.lower, 4);
  const upper = pythonFixedText(comparison.interval.upper, 4);
  const size = String(comparison.sampleSize);
  return `${comparisonSentencePrefix(metric)}${delta}, ci=[${lower}, ${upper}], n=${size}, method=${comparison.method}`;
}

function fewPairsWarning(metric: string, paired: number, minPaired: number): string {
  return `Skipping ${metric}: only ${String(paired)} paired cases, need ${String(minPaired)}`;
}

/** `metric_gate.starved_pairs_failure`, pinned by the `starved_pairs` row. */
function starvedPairsFailure(
  metric: string,
  paired: number,
  minPaired: number,
  starved: number,
): string {
  return (
    `${metric}: only ${String(paired)} paired cases, need ${String(minPaired)} — ` +
    `${String(starved)} of the missing pairs came back as the agent's error payload. ` +
    `Starvation, not a small sample: this metric is unproven, not skipped.`
  );
}
