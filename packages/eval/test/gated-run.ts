import { readFileSync } from 'node:fs';

import { Case, Dataset, Evaluator, type EvaluatorContext } from 'logfire/evals';

import type { ExportedAgentExpected, ExportedAgentInput } from '../src/dataset-roundtrip.ts';
import { parseBaselineRecord, type BaselineRecord } from '../src/gate/baseline-record.ts';
import { baselinePath } from '../src/gate/baseline-store.ts';
import { canonicalDatasetPath, loadCaseStrata } from '../src/gate/case-strata.ts';
import type { AgentEvalReport, GateRunSettings } from '../src/gate-run/gate-run-result.ts';
import {
  BASELINE_MODEL,
  baselineLocation,
} from '../src/gate-run/baseline-identity.ts';
import { metricNames } from '../src/metric-names.ts';
import type { TranscriptResult } from '../src/turn-transcript.ts';

/**
 * A staging run and the gate settings it is judged with, built without staging.
 *
 * The scores are REPLAYED rather than computed: a real run's numbers come from
 * eight evaluators reading a wire transcript, and pinning the gate would then
 * mean pinning all of that too. What this builds is the seam the gate actually
 * sees — a finished `logfire/evals` report whose per-case scores are the ones
 * handed in — so the report machinery (averages, assertions, failures) is the
 * real one and only the numbers are canned.
 */

export type MetricRecord = Record<string, number>;
export type CaseScoreMap = Record<string, MetricRecord>;

/** Pinned so the result file's name and `generated_at` are the same every run. */
export const GENERATED_AT = new Date('2026-09-05T09:30:00.000Z');

/** The set the committed baseline describes; its strata are the real ones. */
export const GATED_DATASET = 'agent_eval_v3';

export interface GatedRun {
  readonly report: AgentEvalReport;
  readonly settings: GateRunSettings;
}

/** The committed record, read the way the runner reads it. Python wrote it
 * until #1515's first capture; the shape and this reader are the same either
 * way, which is the point of `baselineRecordText`' byte parity. */
export function committedBaseline(): BaselineRecord {
  const record = parseBaselineRecord(readFileSync(baselinePath(baselineLocation()), 'utf8'));
  if (record === null) {
    throw new Error('the committed baseline no longer parses');
  }
  return record;
}

/**
 * The first `count` baseline cases that carry every metric.
 *
 * All eight, because a metric only some cases carry falls under the gate's
 * ten-pair floor and is skipped — which is a real verdict but not the one a
 * test about verdicts wants to be measuring by accident.
 */
export function baselineParityScores(count: number): CaseScoreMap {
  const baseline = committedBaseline();
  const width = metricNames({
    hasNonemptyCases: true,
    hasParamsRecorded: true,
    hasMeasuredSteps: true,
    l3Enabled: false,
  }).length;
  const complete = Object.entries(baseline.cases).filter(
    ([, scores]) => Object.keys(scores).length === width,
  );
  return Object.fromEntries(complete.slice(0, count).map(([name, scores]) => [name, { ...scores }]));
}

/** The same run with one metric scored zero everywhere — a regression the gate
 * has to see, and the mutation the exit-code test flips on. */
export function withRegressedMetric(scores: CaseScoreMap, metric: string): CaseScoreMap {
  return Object.fromEntries(
    Object.entries(scores).map(([name, record]) => [name, { ...record, [metric]: 0 }]),
  );
}

/** Replays one case's recorded scores; the returned keys are the metric names. */
class RecordedRun extends Evaluator<ExportedAgentInput, TranscriptResult, ExportedAgentExpected> {
  readonly #scores: CaseScoreMap;

  constructor(scores: CaseScoreMap) {
    super();
    this.#scores = scores;
  }

  evaluate(
    ctx: EvaluatorContext<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>,
  ): MetricRecord {
    return this.#scores[ctx.name ?? ''] ?? {};
  }
}

/**
 * The query names the intent the fake turn will answer with — the one
 * convention this builder has, so a case's breakdown group is legible where the
 * case is constructed. `logfire/evals` hands a task its inputs and nothing
 * else, exactly as pydantic-evals does, so the answer has to be derivable from
 * them.
 */
export function makeAgentInput(
  intent: string,
  locale: string,
  historyTurns = 0,
): ExportedAgentInput {
  return {
    clarification_id: null,
    context: makeRecordedHistory(historyTurns),
    locale,
    query: intent,
    seeded_pending: null,
    selected_candidate_ids: null,
    selected_point_ids: null,
  };
}

/** The turns a case replays before the one under measurement — each one its own
 * `POST /v1/chat`, which is what makes a case cost more than one submission. */
function makeRecordedHistory(turns: number): ExportedAgentInput['context'] {
  return {
    message_history: Array.from({ length: turns }, (_unused, index) => ({
      user: `turn ${String(index)}`,
      assistant: 'ok',
    })),
  };
}

export function makeTranscriptResult(
  intent: string,
  locale: string,
  paramsRecorded = true,
): TranscriptResult {
  return {
    intent,
    success: true,
    message: '',
    locale,
    dataKeys: [],
    paramsRecorded,
    stepCount: 0,
    trajectory: [],
    priorTrajectory: [],
    response: null,
    runStatus: 'succeeded',
  };
}

export type AgentCase = Case<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>;

/** One case: the exported input shape in, a shaped turn out. */
export function makeAgentCase(name: string, intent = 'search_nearby', locale = 'ja'): AgentCase {
  return new Case<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>({
    name,
    inputs: makeAgentInput(intent, locale),
    metadata: { acceptable_stages: [], data_keys: [], expect_nonempty: true },
  });
}

export async function makeReport(
  cases: AgentCase[],
  scores: CaseScoreMap,
  paramsRecorded = true,
): Promise<AgentEvalReport> {
  const dataset = new Dataset<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>({
    name: 'gated-run',
    cases,
    evaluators: [new RecordedRun(scores)],
  });
  return dataset.evaluate((inputs) =>
    makeTranscriptResult(inputs.query, inputs.locale, paramsRecorded),
  );
}

/**
 * The settings a run of THESE scores is judged with.
 *
 * The two per-run columns are DERIVED from the scores rather than pinned on.
 * Pinning them made this builder hand back a `metricNames` naming a column its
 * own cases do not carry — a double that lies about its own state — and the
 * only way to use the pair was to override `metricNames` at the call site,
 * which is a thing no real runner does. `runMetricNames` reads the finished
 * report for the same two facts; this reads the canned scores it is given.
 */
export function makeGateRunSettings(scores: CaseScoreMap): GateRunSettings {
  return {
    dataset: GATED_DATASET,
    caseCount: Object.keys(scores).length,
    metricNames: metricNames({
      hasNonemptyCases: true,
      hasParamsRecorded: someCaseScored(scores, 'argument_correctness'),
      hasMeasuredSteps: someCaseScored(scores, 'step_efficiency'),
      l3Enabled: false,
    }),
    baseline: committedBaseline(),
    baselineModel: BASELINE_MODEL,
    baselineFailures: [],
    baselineWarnings: [],
    strata: loadCaseStrata(canonicalDatasetPath(GATED_DATASET)).byCase,
    strataWarnings: [],
    now: () => GENERATED_AT,
  };
}

export async function makeGatedRun(scores: CaseScoreMap): Promise<GatedRun> {
  const cases = Object.keys(scores).map((name) => makeAgentCase(name));
  return { report: await makeReport(cases, scores), settings: makeGateRunSettings(scores) };
}

/**
 * The same run against an edge that publishes no settled params (#1381): every
 * transcript arrives without the second witness, so no case emits
 * `argument_correctness` and the column is not the run's to report.
 */
export async function makeUnwitnessedRun(scores: CaseScoreMap): Promise<GatedRun> {
  const unwitnessed = withoutMetric(scores, 'argument_correctness');
  const cases = Object.keys(unwitnessed).map((name) => makeAgentCase(name));
  return {
    report: await makeReport(cases, unwitnessed, false),
    settings: makeGateRunSettings(unwitnessed),
  };
}

/**
 * The same run in which every turn took no step on a case that required one
 * (#1439): `StepEfficiency` has no denominator for any of them, so nobody
 * emits `step_efficiency` and the column is not the run's to report.
 */
export async function makeSteplessRun(scores: CaseScoreMap): Promise<GatedRun> {
  const stepless = withoutMetric(scores, 'step_efficiency');
  const cases = Object.keys(stepless).map((name) => makeAgentCase(name));
  return { report: await makeReport(cases, stepless), settings: makeGateRunSettings(stepless) };
}

/** `runMetricNames`' rule, read off the canned scores: one case carrying the
 * metric is enough for the column to be the run's to report. */
function someCaseScored(scores: CaseScoreMap, metric: string): boolean {
  return Object.values(scores).some((record) => metric in record);
}

/** The same scores with one metric emitted by nobody. */
export function withoutMetric(scores: CaseScoreMap, metric: string): CaseScoreMap {
  return Object.fromEntries(
    Object.entries(scores).map(([name, record]) => {
      const { [metric]: _dropped, ...kept } = record;
      return [name, kept];
    }),
  );
}

/** A run whose every turn fell over: `report.failures` only, nothing scored. */
export async function makeFallenOverRun(scores: CaseScoreMap): Promise<GatedRun> {
  const dataset = new Dataset<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>({
    name: 'fallen-over-run',
    cases: Object.keys(scores).map((name) => makeAgentCase(name)),
    evaluators: [new RecordedRun(scores)],
  });
  const report = await dataset.evaluate((): TranscriptResult => {
    throw new Error('the turn never reached staging');
  });
  return { report, settings: makeGateRunSettings(scores) };
}
