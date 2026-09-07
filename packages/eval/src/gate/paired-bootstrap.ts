import { PythonRandom } from './python-random.ts';
import { pythonSum } from './python-sum.ts';

/**
 * `stats.py`'s stratified paired bootstrap.
 *
 * Cases are grouped by behaviour path and resampled **within** each group, so
 * every draw keeps the run's mix of behaviours; pooling the deltas would let a
 * small stratum that carries a regression wash out.
 *
 * Everything here is a literal port: the stratum order (`sorted`), the
 * summation CPython's `sum()` performs on the pinned 3.11 interpreter, the
 * percentile index (`int(q * (n - 1))`, truncating) and
 * the generator. The interval is bit-identical to Python's for the same seed.
 */

export type Verdict = 'pass' | 'fail' | 'indeterminate';

/** The stratum a case falls into when its dataset does not name one. */
export const UNSTRATIFIED = 'unstratified';

/** A closed confidence interval. */
export interface Interval {
  readonly lower: number;
  readonly upper: number;
}

/** A three-way gate comparison with uncertainty evidence. */
export interface Comparison {
  readonly verdict: Verdict;
  readonly estimate: number;
  readonly interval: Interval;
  readonly sampleSize: number;
  readonly method: string;
}

/** One baseline/current score pair and its behaviour-family stratum. */
export interface PairedScore {
  readonly baseline: number;
  readonly current: number;
  readonly stratum: string;
}

export interface PairedBootstrapOptions {
  readonly iterations?: number;
  readonly confidence?: number;
  readonly seed?: number;
  readonly minEffect?: number;
}

export const PAIRED_BOOTSTRAP_METHOD = 'stratified-paired-bootstrap';
export const DEFAULT_SEED = 309;
export const DEFAULT_ITERATIONS = 2000;
export const DEFAULT_CONFIDENCE = 0.95;
export const DEFAULT_PAIRED_MIN_EFFECT = 0.01;

/** Compare paired scores while preserving behaviour-family proportions. */
export function stratifiedPairedComparison(
  pairs: readonly PairedScore[],
  options: PairedBootstrapOptions = {},
): Comparison {
  const {
    iterations = DEFAULT_ITERATIONS,
    confidence = DEFAULT_CONFIDENCE,
    seed = DEFAULT_SEED,
    minEffect = DEFAULT_PAIRED_MIN_EFFECT,
  } = options;
  const samples = bootstrapSamples(stratifiedDeltas(pairs), iterations, seed);
  const interval = sampleInterval(samples, confidence);
  const estimate = mean(pairs.map((pair) => pair.baseline - pair.current));
  return {
    verdict: pairedVerdict(interval, minEffect),
    estimate,
    interval,
    sampleSize: pairs.length,
    method: PAIRED_BOOTSTRAP_METHOD,
  };
}

export function pairedVerdict(interval: Interval, minEffect: number): Verdict {
  if (interval.lower > minEffect) {
    return 'fail';
  }
  return interval.upper <= minEffect ? 'pass' : 'indeterminate';
}

export function sampleInterval(samples: readonly number[], confidence: number): Interval {
  const tail = (1 - confidence) / 2;
  return { lower: percentile(samples, tail), upper: percentile(samples, 1 - tail) };
}

/** Deltas grouped by stratum, in the sorted stratum order Python groups them. */
function stratifiedDeltas(pairs: readonly PairedScore[]): number[][] {
  const grouped = new Map<string, number[]>();
  for (const pair of pairs) {
    const group = grouped.get(pair.stratum) ?? [];
    group.push(pair.baseline - pair.current);
    grouped.set(pair.stratum, group);
  }
  return [...grouped.keys()].sort().map((name) => grouped.get(name) ?? []);
}

function bootstrapSamples(strata: number[][], iterations: number, seed: number): number[] {
  const random = new PythonRandom(seed);
  const count = Math.max(iterations, 1);
  const samples: number[] = [];
  for (let draw = 0; draw < count; draw += 1) {
    samples.push(stratifiedMean(strata, random));
  }
  return samples.sort((left, right) => left - right);
}

function stratifiedMean(strata: number[][], random: PythonRandom): number {
  const resampled = strata.map((group) => resample(group, random));
  const size = resampled.reduce((total, group) => total + group.length, 0);
  return pythonSum(resampled.map(pythonSum)) / size;
}

function resample(values: number[], random: PythonRandom): number[] {
  return values.map(() => random.choice(values));
}

function percentile(values: readonly number[], quantile: number): number {
  return values[Math.trunc(quantile * (values.length - 1))] ?? Number.NaN;
}

function mean(values: readonly number[]): number {
  return pythonSum(values) / values.length;
}
