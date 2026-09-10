import type { BaselineRecord } from '../gate/baseline-record.ts';
import { comparisonSentencePrefix } from '../gate/metric-gate.ts';
import type { BaselineCandidate } from './baseline-candidate.ts';

/**
 * Which finished TS run may become the floor every later run is judged against
 * (#1515; owner decision 2026-09-08 on #1303).
 *
 * `baseline_mint.py` is the Python twin and the rule is its rule: judging a run
 * and minting from one are different questions. Under the outage ceiling a run
 * is judgeable — few enough boundary answers to trust what the rest measured —
 * but a record minted from it carries those cases' green columns as the
 * standing floor, and every later run is then compared against an outage
 * (#1499). ANY starved case refuses the write. There is no share to argue
 * about, because there is no hurry: a refused capture costs one ungated run.
 *
 * THREE MORE REFUSALS ARE THIS SIDE'S OWN, and they exist because this runner
 * mints from a FILE rather than from the run in flight. A capped run describes
 * a subset of the set, so a record made from it is stale on arrival for every
 * uncapped run after it. A record already on disk is the floor somebody is
 * being judged against right now — retiring it is a decision, so it takes the
 * `--replace` flag and lands in a diff someone reads. And a run that went RED
 * for any reason other than a metric regressing against the record it replaces
 * may not mint at all: Python's `_run_uncapped_gate` writes only when nothing
 * failed, and the ONE red a first capture legitimately carries is the TS run
 * scoring below the Python record being retired (#1303). An outage, an error
 * rate over the ceiling, a metric starvation emptied, a damaged or foreign
 * baseline — none of those say anything about the agent, and a floor minted
 * over them is a lie every later run is measured with.
 *
 * THE RUN BEING JUDGED STILL DOES NOT WRITE WHAT JUDGES IT. This module is
 * called by `scripts/eval-baseline-capture.ts`, a second command over a
 * committed result file, never from `eval-gate.ts` — `gate-exit-code.ts` has no
 * "baseline created" answer and gains none.
 */

/** What the capture knows that the result file does not. */
export interface CaptureTerms {
  /** The baseline's identity, pinned in `baseline-identity.ts` — never a flag. */
  readonly modelId: string;
  readonly tier: string;
  /** Every case the canonical dataset carries: the count an uncapped run has. */
  readonly datasetCaseCount: number;
  readonly recordExists: boolean;
  readonly replace: boolean;
}

/** The record this run may become, or every reason it may not. */
export interface CaptureVerdict {
  readonly record: BaselineRecord | null;
  readonly refusals: readonly string[];
}

export function captureBaseline(run: BaselineCandidate, terms: CaptureTerms): CaptureVerdict {
  const refusals = [
    cappedRunRefusal(run, terms),
    starvedRunRefusal(run),
    failedRunRefusal(run),
    occupiedPathRefusal(terms),
  ].flatMap((line) => (line === null ? [] : [line]));
  if (refusals.length > 0) {
    return { record: null, refusals };
  }
  return { record: capturedRecord(run, terms), refusals: [] };
}

/**
 * `baseline_mint.baseline_mint_refusal`, word for word: one rule deserves one
 * sentence. Neither side is pinned by `stats-oracle.json` — it carries no
 * baseline-mint section, because until this card only one language could write
 * a record — so the two literals are kept in step by hand, as the outage gate's
 * blamed string is.
 */
function starvedRunRefusal(run: BaselineCandidate): string | null {
  const starved = run.starved_cases.length;
  if (starved === 0) {
    return null;
  }
  return (
    `refusing to write a baseline from a run with ${String(starved)}/` +
    `${String(run.evaluated_count)} starved cases: the record would make an ` +
    'outage the floor every later run is judged against. Re-run the suite; a ' +
    'clean run mints it.'
  );
}

/**
 * The one red a first capture may carry, and the wall in front of every other.
 *
 * A failure is a REGRESSION against the record being replaced exactly when the
 * run's own metric rows explain it: `metric-gate.ts` writes one sentence per
 * failed metric and `comparisonSentencePrefix` is how it starts, so a failure
 * no failed row accounts for came from somewhere else — the outage gate, the
 * error-rate gate, a metric starvation emptied, or the baseline read. This is
 * an ALLOW list on purpose: recognising the other families by their wording
 * would let a family invented tomorrow mint silently.
 *
 * `error_rate` is refused by that rule without being named in it: its sentence
 * is comparison-shaped, but no baseline names `error_rate` as a metric, so the
 * run carries no row for it and the sentence is never explained.
 */
function failedRunRefusal(run: BaselineCandidate): string | null {
  const blocking = unexplainedFailures(run);
  if (blocking.length === 0) {
    return null;
  }
  return (
    'refusing to write a baseline from a run whose red is not a regression ' +
    `against the record it replaces: ${String(blocking.length)} of ` +
    `${String(run.failures.length)} failures are something else — ` +
    blocking.join(' / ')
  );
}

/** Every failure no failed metric row accounts for. */
function unexplainedFailures(run: BaselineCandidate): readonly string[] {
  const regressed = run.metrics
    .filter((row) => row.verdict === 'fail')
    .map((row) => comparisonSentencePrefix(row.metric));
  return run.failures.filter((line) => !regressed.some((prefix) => line.startsWith(prefix)));
}

/** A record describing a subset is stale for every uncapped run after it. */
function cappedRunRefusal(run: BaselineCandidate, terms: CaptureTerms): string | null {
  if (run.case_count === terms.datasetCaseCount) {
    return null;
  }
  return (
    `refusing to write a baseline from a capped run: it set out to evaluate ` +
    `${String(run.case_count)} of ${run.dataset}'s ${String(terms.datasetCaseCount)} ` +
    'cases, and a record describing a subset is stale for every uncapped run ' +
    'after it. Re-run without --limit.'
  );
}

/** Retiring the standing floor is a decision, so it is spelled out. */
function occupiedPathRefusal(terms: CaptureTerms): string | null {
  if (!terms.recordExists || terms.replace) {
    return null;
  }
  return (
    'refusing to overwrite the committed baseline: it is the floor every run ' +
    'is judged against today. Pass --replace to retire it.'
  );
}

/** This run, in the shape every later run is compared against. */
function capturedRecord(run: BaselineCandidate, terms: CaptureTerms): BaselineRecord {
  return {
    schema_version: 2,
    model: terms.modelId,
    dataset: run.dataset,
    tier: terms.tier,
    evaluator_version: run.evaluator_version,
    repeat: 1,
    case_count: run.case_count,
    evaluated_count: run.evaluated_count,
    errored_count: run.errored_count,
    scores: run.scores,
    cases: run.case_scores,
    note: capturedNote(run),
  };
}

/**
 * Where the record came from, in the record. `note` is free text pydantic
 * defaults to `None` and no gate reads, which is exactly what makes it the
 * right place: a TS-born baseline that looked identical to the Python-written
 * one it replaced would leave its own provenance to a doc nobody diffs.
 */
function capturedNote(run: BaselineCandidate): string {
  return `captured from the TS tier's ${run.dataset} gate run of ${run.generated_at} (#1515)`;
}
