/**
 * One structured record per FAILED case, saying where the turn first went wrong
 * (E-4 #1383, spec §十 10.4).
 *
 * REPORT-ONLY, BY THE SAME MECHANISM E-3 ESTABLISHED. `report-only-metrics.ts`
 * is the precedent and this is the same shape of thing, not a second one: a
 * function the gate run calls over the FINISHED report, landing in its own field
 * of `GateRunResult` beside `report_only`. It therefore cannot reach
 * `metricNames()` (positionally aligned with the committed baseline), it
 * cannot reach `caseScoresFromReport` (what the bootstrap gate compares), and it
 * cannot reach the exit code. It has a field of its own rather than a key inside
 * `report_only` only because that map is typed as metric COLUMNS and an
 * attribution is not a column.
 *
 * WHAT COUNTS AS A FAILED CASE, reusing the run's own two verdicts rather than
 * inventing a threshold:
 *
 * - **An errored case is not attributed.** `report.failures` is the run's only
 *   per-case verdict today — the error-rate gate's numerator
 *   (`report-gate-input.ts`) — and such a case has no output at all: no
 *   trajectory to index into and no reply to read. They are counted here and
 *   left to the gate that owns them, exactly as `score-breakdown.ts` and
 *   `report-only-metrics.ts` leave them.
 * - **An evaluated case failed when any of its own scores is below 1.** The
 *   scores are `caseScoresFromReport`'s — literally the per-case record the
 *   bootstrap gate is fed, assertions folded in as 1/0 — plus the report-only
 *   reply-claim column, which is the one measurement of the SENTENCE and the
 *   whole reason §十 10.3 exists. No threshold is chosen: every metric here is
 *   in [0, 1] and 1 is what each evaluator emits for "nothing was violated"
 *   (`bestOverChains`' `_best(..., empty=1.0)`, `StepEfficiency`'s cap,
 *   `MaxToolCalls`' budget). Anything less is the evaluator's own record of a
 *   deviation. An unmeasured metric is `{}` and is absent, never a zero.
 *   Measured against the committed 657-case baseline this makes 312 cases
 *   failed and 345 perfect, so it is a real split and not "everything".
 *
 * Letting the report-only column decide a case is failed does not put it in the
 * verdict: attribution as a whole sits outside the verdict, and a definition
 * that excluded it would rebuild the exact blind spot 10.3 was written to
 * remove — 「多数评估只检查环境状态」.
 *
 * MAIN CAUSE AND CONSEQUENCES ARE SEPARATE FIELDS, which is the book's whole
 * point: 「后续错误往往只是连锁反应」. `cause` is the earliest deviation
 * (`first-deviation.ts`); `consequences` is every later one in order; and
 * `failed_metrics` is the downstream observable — the columns that ended up
 * below their maximum because of it.
 *
 * A FAILED CASE THE RULES CANNOT PLACE GETS NO RECORD, and is named under
 * `unattributed` instead. A locale slip or a data-key miss is a metric outcome
 * with no position in the trajectory; inventing an index for it (step 0, say)
 * would be a fabricated root cause, which is the one thing an attribution record
 * must never contain. Making the gap countable is what keeps it from being
 * silent — it is also the size of the job an LLM second pass would have, if the
 * owner ever wants one.
 */
import type { EvaluationReport, ReportCase } from 'logfire/evals';

import type { ExportedAgentExpected, ExportedAgentInput } from '../dataset-roundtrip.ts';
import { replyClaimTraceability } from '../evaluators/reply-claim-verifier.ts';
import { caseScoresFromReport } from '../gate/report-gate-input.ts';
import type { TranscriptResult } from '../turn-transcript.ts';
import { declaredToolName } from './declared-tool-name.ts';
import { deviationsOf, orderedDeviations, type Deviation } from './first-deviation.ts';
import { decidedClaimsOf, type DecidedClaim } from './unsourced-claims.ts';

/** The value every metric here reports when nothing was violated. */
const METRIC_MAXIMUM = 1;

type AgentReport = EvaluationReport<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>;
type AgentCase = ReportCase<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>;

/**
 * One failed case, analysed once. It carries the case's RAW inputs and turn
 * because the evidence projection needs them; the committed projection below is
 * what drops them, and that asymmetry is the whole boundary
 * (`attribution-evidence.ts`).
 */
export interface FailedCase {
  readonly caseId: string;
  readonly cause: Deviation;
  readonly consequences: readonly Deviation[];
  readonly failedMetrics: Readonly<Record<string, number>>;
  readonly inputs: ExportedAgentInput;
  readonly output: TranscriptResult;
  readonly claims: readonly DecidedClaim[];
}

/** One run's failures, before either projection. */
export interface FailureAnalysis {
  readonly failedCases: readonly FailedCase[];
  /** Failed cases with no locatable deviation, by id. */
  readonly unattributed: readonly string[];
  readonly erroredCases: number;
}

/** One attributed case, in the shape the COMMITTED result file carries: ids,
 * indices, tool names and numbers, and no text a visitor or a model wrote. */
export interface CaseAttribution {
  readonly case_id: string;
  readonly cause: Deviation;
  readonly consequences: readonly Deviation[];
  readonly failed_metrics: Readonly<Record<string, number>>;
}

export interface RunFailureAttribution {
  readonly failed_cases: number;
  readonly errored_cases: number;
  readonly by_category: Readonly<Record<string, number>>;
  readonly unattributed: readonly string[];
  /** WHERE THE RAW EVIDENCE WENT — a reference, not the evidence. */
  readonly evidence_artifact: string;
  readonly cases: readonly CaseAttribution[];
}

function belowMaximum(scores: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(scores).filter(([, value]) => value < METRIC_MAXIMUM),
  );
}

/** Every score this case was measured on: the gate's own per-case record, plus
 * the report-only column the gate does not compare. */
function measuredScores(
  entry: AgentCase,
  gated: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  return { ...gated, ...replyClaimTraceability(entry.inputs, entry.output) };
}

function analysedCase(entry: AgentCase, failedMetrics: Record<string, number>): FailedCase | null {
  const ordered = orderedDeviations(
    deviationsOf(entry.inputs, entry.metadata, entry.output),
    entry.output.trajectory.length,
  );
  const [cause, ...consequences] = ordered;
  if (cause === undefined) return null;
  return {
    caseId: entry.name,
    cause,
    consequences,
    failedMetrics,
    inputs: entry.inputs,
    output: entry.output,
    claims: decidedClaimsOf(entry.inputs, entry.output),
  };
}

/** One case that failed, before anyone has tried to place it. */
interface FailedEntry {
  readonly entry: AgentCase;
  readonly failedMetrics: Record<string, number>;
}

/** WHICH cases failed — the definition above, and nothing about where. */
function failedEntries(report: AgentReport): FailedEntry[] {
  const gated = caseScoresFromReport(report);
  return report.cases
    .map((entry) => ({ entry, failedMetrics: belowMaximum(measuredScores(entry, gated[entry.name])) }))
    .filter((one) => Object.keys(one.failedMetrics).length > 0);
}

/** The failed cases of one run, each placed or explicitly not placed. The two
 * halves are separate functions because they answer separate questions: which
 * cases failed is the run's own verdict, and where each one went wrong is the
 * rules'. */
export function analyseFailures(report: AgentReport): FailureAnalysis {
  const placed = failedEntries(report).map((one) => ({
    caseId: one.entry.name,
    analysed: analysedCase(one.entry, one.failedMetrics),
  }));
  return {
    failedCases: placed.map((one) => one.analysed).filter((one) => one !== null),
    unattributed: placed.filter((one) => one.analysed === null).map((one) => one.caseId),
    erroredCases: report.failures.length,
  };
}

function categoryCounts(cases: readonly FailedCase[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const one of cases) counts[one.cause.category] = (counts[one.cause.category] ?? 0) + 1;
  return counts;
}

/** The one member of a deviation that is model text rather than a fact about a
 * position: `toolName` comes verbatim off a `tool-input-start` frame, so the
 * committed record states it only when the contract declares it
 * (`declared-tool-name.ts`). The artifact keeps the raw value. */
function committedDeviation(one: Deviation): Deviation {
  return { ...one, tool_name: declaredToolName(one.tool_name) };
}

function committedCase(one: FailedCase): CaseAttribution {
  return {
    case_id: one.caseId,
    cause: committedDeviation(one.cause),
    consequences: one.consequences.map(committedDeviation),
    failed_metrics: one.failedMetrics,
  };
}

/**
 * The committed projection. Every member is an aggregate, an id, an index, a
 * tool name or a number — the `result-file.ts` rule, 「Nothing here is a secret:
 * scores, intervals and case counts」, held to for a record that is built out of
 * a visitor's own turn. `run_steps` is not even granted to the `readonly` role
 * because 「a tool's input and result carry the visitor's own query text」
 * (`migrations/neon/20260902000000_agent_runs.sql:10-12`), and an
 * `injection_g1_v1` failure carries the injection itself.
 */
export function attributionRecordOf(
  analysis: FailureAnalysis,
  evidenceArtifact: string,
): RunFailureAttribution {
  return {
    failed_cases: analysis.failedCases.length + analysis.unattributed.length,
    errored_cases: analysis.erroredCases,
    by_category: categoryCounts(analysis.failedCases),
    unattributed: analysis.unattributed,
    evidence_artifact: evidenceArtifact,
    cases: analysis.failedCases.map(committedCase),
  };
}
