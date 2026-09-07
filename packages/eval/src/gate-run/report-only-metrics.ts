/**
 * The columns a run REPORTS without being judged on them (E-3 #1382, spec §十
 * 10.3 「先 report-only」).
 *
 * WHY THEY ARE NOT IN `scores`. `GateRunResult.scores` is `metricNames()`
 * applied to the report, and that list is aligned BY POSITION with the
 * committed Python baseline and the report tables (`metric-names.ts`). Inserting
 * a ninth column there would shift every baseline comparison by one and the
 * double run would stop being a comparison at all — so a metric with no Python
 * twin gets its own field, next to the scores and outside the gate. The owner
 * decides after a full baseline cycle whether it graduates (#1303).
 *
 * WHY IT IS COMPUTED HERE AND NOT BY AN EVALUATOR. An evaluator emits into
 * `report.cases[].scores`, which is what `caseScoresFromReport` hands the
 * bootstrap gate — a report-only metric that scored there would be compared
 * against a baseline that never had it. Reading the finished report instead
 * keeps "report-only" a structural fact rather than a promise.
 *
 * A METRIC NOBODY COULD MEASURE REPORTS `null`, not 0 and not 1. The verifier
 * returns `{}` for a reply with no decidable claim, and a run of such replies
 * has measured nothing; a mean of zero cases would read as a perfect (or a
 * failed) run depending only on which fallback was chosen.
 */
import type { EvaluationReport } from "logfire/evals";

import type { ExportedAgentInput } from "../dataset-roundtrip.ts";
import {
  REPLY_CLAIM_METRIC,
  replyClaimTraceability,
} from "../evaluators/reply-claim-verifier.ts";
import type { TranscriptResult } from "../turn-transcript.ts";

/** One report-only column: what it averaged, over how many cases it applied to. */
export interface ReportOnlyMetric {
  readonly measured_cases: number;
  readonly mean: number | null;
}

/** Every report-only column of one run, by metric name. */
export type ReportOnlyMetrics = Readonly<Record<string, ReportOnlyMetric>>;

/** The report as this module reads it: the case's own inputs and its turn. */
type AgentReport = EvaluationReport<ExportedAgentInput, TranscriptResult>;

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function column(values: readonly number[]): ReportOnlyMetric {
  return { measured_cases: values.length, mean: mean(values) };
}

/** The scores the verifier could give, over the cases that produced a turn.
 * Errored cases have no output to read a reply off; they are the error-rate
 * gate's business, exactly as in `score-breakdown.ts`. */
function replyClaimScores(report: AgentReport): number[] {
  return report.cases
    .map((entry) => replyClaimTraceability(entry.inputs, entry.output)[REPLY_CLAIM_METRIC])
    .filter((score) => score !== undefined);
}

export function reportOnlyMetricsOf(report: AgentReport): ReportOnlyMetrics {
  return { [REPLY_CLAIM_METRIC]: column(replyClaimScores(report)) };
}
