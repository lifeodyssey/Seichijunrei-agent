import type { EvaluationReport } from 'logfire/evals';

import type { ExportedAgentExpected, ExportedAgentInput } from '../dataset-roundtrip.ts';
import { EVALUATOR_VERSION } from '../evaluators/agent-evaluator.ts';
import type { BaselineRecord } from '../gate/baseline-record.ts';
import { DEFAULT_MIN_PAIRED } from '../gate/metric-gate.ts';
import { DEFAULT_PROPORTION_MIN_EFFECT } from '../gate/clopper-pearson.ts';
import {
  DEFAULT_CONFIDENCE,
  DEFAULT_ITERATIONS,
  DEFAULT_PAIRED_MIN_EFFECT,
  DEFAULT_SEED,
  type Interval,
  type Verdict,
} from '../gate/paired-bootstrap.ts';
import { gateInputFromReport } from '../gate/report-gate-input.ts';
import type { TranscriptResult } from '../turn-transcript.ts';
import { attributionEvidenceRef } from './attribution-evidence.ts';
import {
  analyseFailures,
  attributionRecordOf,
  type RunFailureAttribution,
} from './failure-attribution.ts';
import { starvedCaseIdsOf } from './provider-outage.ts';
import { reportOnlyMetricsOf, type ReportOnlyMetrics } from './report-only-metrics.ts';
import { scoreBreakdownOf, type ScoreBreakdown } from './score-breakdown.ts';
import { judgement } from './run-judgement.ts';
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
 * this is the file's own shape, it sits next to the baseline records
 * `baseline-record.ts` writes, and a camelCase mirror would only be a mapping
 * layer to get wrong.
 *
 * WHAT IT DOES NOT DO IS WRITE A BASELINE. Python's uncapped run creates one
 * when none is found (`_run_uncapped_gate`); this runner never does. A runner
 * that could write the record it is judged by is a runner that can make itself
 * pass — the failure mode `apps/agent/AGENTS.md` names as "never refresh a
 * baseline merely to pass a gate".
 *
 * WHAT IT DOES DO, SINCE #1515, IS CARRY EVERYTHING A CAPTURE NEEDS: the
 * per-case scores, the starved case ids and the evaluator vocabulary. The
 * owner's 2026-09-08 decision on #1303 makes this tier's own uncapped run the
 * next baseline, and `scripts/eval-baseline-capture.ts` mints it — from this
 * committed file, in a second command a person runs, never from the run in
 * flight. A result file that could not say what each case scored could not be
 * that input, and could not be re-audited either.
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
  /** What the strata load had to say — a dataset with no `path` column pools
   * into one stratum, and the result file must carry that line (#1478). */
  readonly strataWarnings: readonly string[];
  /** Injected so a test can pin the date the result file is named for. */
  readonly now: () => Date;
}

export interface GateRunResult {
  readonly schema_version: 1;
  readonly generated_at: string;
  readonly dataset: string;
  readonly baseline_model: string;
  /** The evaluator vocabulary these numbers were scored in
   * (`evaluators/agent-evaluator.ts`). Recorded rather than re-read from the
   * code at capture time: a record stamped from a later checkout's constant
   * would claim a vocabulary that never touched these scores (#1303). */
  readonly evaluator_version: string;
  readonly seed: number;
  readonly iterations: number;
  readonly confidence: number;
  readonly min_effect: number;
  readonly proportion_min_effect: number;
  readonly min_paired: number;
  readonly case_count: number;
  readonly evaluated_count: number;
  readonly errored_count: number;
  /** The evaluated cases whose turn published no answer at all
   * (`provider-outage.ts`). Reported even when the run was under the ceiling
   * and therefore judged: the outage gate's own numerator, and the fact
   * `baseline-capture.ts` refuses a mint on (#1499). */
  readonly starved_cases: readonly string[];
  readonly scores: Readonly<Record<string, number>>;
  /** The columns that are reported and NOT gated (`report-only-metrics.ts`).
   * Its own field rather than a ninth entry in `scores`, because `scores` is
   * positionally aligned with the committed baseline. */
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
  /** Every evaluated case's own scores — `caseScoresFromReport`, the same map
   * the metric gate compares and a baseline record's `cases` is. LAST in the
   * file because it is larger than everything above it put together, and empty
   * for a starved run for the reason `scores` is (`run-judgement.ts`). */
  readonly case_scores: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export function gateRunResultOf(
  report: AgentEvalReport,
  settings: GateRunSettings,
): GateRunResult {
  const identity = runIdentity(settings);
  const input = gateInputFromReport(report);
  // `case_scores` is pulled out of the judgement and re-attached at the end:
  // it is the one field a reader scrolls past rather than reads.
  const { case_scores, ...judged } = judgement(report, settings, input);
  return {
    ...identity,
    ...pinnedGateSettings(),
    case_count: settings.caseCount,
    evaluated_count: input.evaluatedCount,
    errored_count: input.erroredCount,
    starved_cases: [...starvedCaseIdsOf(report)],
    ...judged,
    report_only: reportOnlyMetricsOf(report),
    failure_attribution: attributionRecordOf(
      analyseFailures(report),
      attributionEvidenceRef(identity.generated_at, identity.dataset),
    ),
    breakdown: scoreBreakdownOf(report),
    spend: runSpendOf(report),
    case_scores,
  };
}

function runIdentity(
  settings: GateRunSettings,
): Pick<
  GateRunResult,
  'schema_version' | 'generated_at' | 'dataset' | 'baseline_model' | 'evaluator_version'
> {
  return {
    schema_version: 1,
    generated_at: settings.now().toISOString(),
    dataset: settings.dataset,
    baseline_model: settings.baselineModel,
    evaluator_version: EVALUATOR_VERSION,
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
