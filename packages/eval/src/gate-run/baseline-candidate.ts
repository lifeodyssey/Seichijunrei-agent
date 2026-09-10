import { EXPORTED_DATASETS } from '../dataset-sets.ts';
import { parsedCaseScores, parsedMetricScores } from '../gate/baseline-record.ts';

/**
 * One finished gate run, read back off disk as something that might become a
 * baseline (#1515).
 *
 * Its own module, next to the decision rather than inside it: reading a
 * committed `GateRunResult` back is a different job from judging whether that
 * run may mint, and only the first one has to know the file's shape. Parsing is
 * total, like `parseBaselineRecord`'s — a malformed file is `null` and never a
 * throw, so the script that calls this is the one place that decides what an
 * unreadable file MEANS. A result file written before #1515 carries no
 * `case_scores` and lands here as `null`: it cannot say what each case scored,
 * so it cannot become a record.
 */

/** One metric's verdict, as the result file records it (`MetricVerdictRow`). */
export interface CandidateMetricVerdict {
  readonly metric: string;
  readonly verdict: string;
}

/** The finished run a capture reads, as its committed result file describes it. */
export interface BaselineCandidate {
  readonly generated_at: string;
  readonly dataset: string;
  readonly evaluator_version: string;
  readonly case_count: number;
  readonly evaluated_count: number;
  readonly errored_count: number;
  readonly scores: Readonly<Record<string, number>>;
  readonly case_scores: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly starved_cases: readonly string[];
  readonly failures: readonly string[];
  readonly metrics: readonly CandidateMetricVerdict[];
}

/** The refusal for a file this module could not read — one sentence, like the
 * four `baseline-capture.ts` gives, rather than a stack trace over a typo. */
export function unreadableResultRefusal(path: string): string {
  return (
    `refusing to write a baseline from ${path}: it could not be read as a gate ` +
    'run result carrying per-case scores. Point --result at a file eval:gate wrote.'
  );
}

/**
 * The refusal for a file that parsed but names a set nobody exports — one
 * sentence, like the read failure above, because a dataset that does not exist
 * and a path that does not open are the same typo to whoever typed the flag.
 * Naming the six is what makes it actionable, exactly as `checkedDatasetName`'s
 * RangeError does for a runner's own flag.
 */
export function unknownDatasetRefusal(dataset: string): string {
  const known = EXPORTED_DATASETS.map((set) => set.name).join(', ');
  return (
    `refusing to write a baseline from a run of "${dataset}": this package ` +
    'exports no such dataset, so what an uncapped run of it counts is unknown. ' +
    `One of: ${known}.`
  );
}

/**
 * A committed `GateRunResult` read back as a capture candidate — total, like
 * `parseBaselineRecord`, so the script that calls it is the one place that
 * decides what an unreadable file MEANS. A result file written before #1515
 * carries no `case_scores` and lands here as `null`: it cannot say what each
 * case scored, so it cannot become a record.
 */
export function parseBaselineCandidate(text: string): BaselineCandidate | null {
  const raw = jsonObject(text);
  return raw === null ? null : candidateFrom(raw);
}

/**
 * The five readings one finished run is, folded into it. Each is total and any
 * one of them saying `null` answers for the whole file: a candidate missing a
 * field is not a run with a gap in it, it is a file this cannot judge.
 */
function candidateFrom(raw: Record<string, unknown>): BaselineCandidate | null {
  const scores = parsedMetricScores(raw.scores);
  const cases = parsedCaseScores(raw.case_scores);
  const named = candidateNames(raw);
  const counts = candidateCounts(raw);
  const reds = candidateReds(raw);
  if (scores === null || cases === null || named === null || counts === null || reds === null) {
    return null;
  }
  return { ...named, ...counts, ...reds, scores, case_scores: cases };
}

/** What the run said went wrong, and what its metrics were judged to be. */
function candidateReds(
  raw: Record<string, unknown>,
): Pick<BaselineCandidate, 'starved_cases' | 'failures' | 'metrics'> | null {
  const starved = textList(raw.starved_cases);
  const failures = textList(raw.failures);
  const metrics = metricVerdicts(raw.metrics);
  if (starved === null || failures === null || metrics === null) {
    return null;
  }
  return { starved_cases: starved, failures, metrics };
}

function metricVerdicts(value: unknown): readonly CandidateMetricVerdict[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const rows: readonly unknown[] = value;
  const parsed = rows.flatMap((row) => (isVerdictRow(row) ? [verdictRow(row)] : []));
  return parsed.length === rows.length ? parsed : null;
}

function isVerdictRow(row: unknown): row is Record<string, unknown> {
  if (row === null || typeof row !== 'object') {
    return false;
  }
  const fields = row as Record<string, unknown>;
  return typeof fields.metric === 'string' && typeof fields.verdict === 'string';
}

function verdictRow(row: Record<string, unknown>): CandidateMetricVerdict {
  return { metric: String(row.metric), verdict: String(row.verdict) };
}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function candidateNames(
  raw: Record<string, unknown>,
): Pick<BaselineCandidate, 'generated_at' | 'dataset' | 'evaluator_version'> | null {
  const { generated_at: generatedAt, dataset, evaluator_version: version } = raw;
  if (typeof generatedAt !== 'string' || typeof dataset !== 'string' || typeof version !== 'string') {
    return null;
  }
  return { generated_at: generatedAt, dataset, evaluator_version: version };
}

function candidateCounts(
  raw: Record<string, unknown>,
): Pick<BaselineCandidate, 'case_count' | 'evaluated_count' | 'errored_count'> | null {
  const caseCount = integer(raw.case_count);
  const evaluated = integer(raw.evaluated_count);
  const errored = integer(raw.errored_count);
  if (caseCount === null || evaluated === null || errored === null) {
    return null;
  }
  return { case_count: caseCount, evaluated_count: evaluated, errored_count: errored };
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function textList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids: readonly unknown[] = value;
  return ids.every(isText) ? ids : null;
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}
