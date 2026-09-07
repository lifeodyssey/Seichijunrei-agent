import type { EvaluationResultJson, ReportCase } from 'logfire/evals';

import type { ExportedAgentExpected, ExportedAgentInput } from '../src/dataset-roundtrip.ts';
import type { AgentEvalReport } from '../src/gate-run/gate-run-result.ts';
import { TURN_SECONDS_ATTRIBUTE } from '../src/staging-turn-task.ts';
import type { TranscriptResult } from '../src/turn-transcript.ts';
import { makeAgentInput, makeTranscriptResult, type MetricRecord } from './gated-run.ts';
import type { AttributedTurn } from './make-attributed-turn.ts';

/**
 * A finished report, assembled rather than evaluated.
 *
 * `gated-run.ts` runs a real `Dataset.evaluate` with canned scores, which is
 * the better subject for anything about the gate. This exists for the one
 * thing that cannot be pinned that way: a case's seconds. `task_duration` comes
 * from `logfire/evals`' own clock during an evaluate, and `turn_seconds` from
 * whatever clock the task ran on, so a test that asserted on either would be
 * asserting on how fast the machine happened to be.
 */

export interface CannedCaseSpec {
  readonly name: string;
  readonly scores: MetricRecord;
  readonly intent?: string;
  readonly locale?: string;
  /** What this case's own turns took — what `run-spend.ts` reads (#1476). */
  readonly seconds?: number;
  /** Turns the case replays before the measured one; each is a submission. */
  readonly historyTurns?: number;
  /** The turn this case produced, when the test is about the turn rather than
   * the score (E-4 #1383: attribution reads the trajectory and the reply). */
  readonly turn?: AttributedTurn;
}

const DEFAULT_INTENT = 'search_nearby';
const DEFAULT_LOCALE = 'ja';

/** The seconds a canned case spent QUEUED, which the driver's own
 * `task_duration` includes and the run's spend must not (#1476). They are apart
 * here because equal numbers would let a sum over either column pass. */
const QUEUED_SECONDS = 10;

/** The three members a `turn` overrides wholesale, defaulted from the spec. */
function casedTurn(
  spec: CannedCaseSpec,
): Pick<
  ReportCase<ExportedAgentInput, TranscriptResult, ExportedAgentExpected>,
  'inputs' | 'metadata' | 'output'
> {
  const intent = spec.intent ?? DEFAULT_INTENT;
  const locale = spec.locale ?? DEFAULT_LOCALE;
  return {
    inputs: spec.turn?.inputs ?? makeAgentInput(intent, locale, spec.historyTurns ?? 0),
    metadata: spec.turn?.metadata ?? { acceptable_stages: [], data_keys: [], expect_nonempty: true },
    output: spec.turn?.output ?? makeTranscriptResult(intent, locale),
  };
}

export function makeCannedCase(
  spec: CannedCaseSpec,
): ReportCase<ExportedAgentInput, TranscriptResult, ExportedAgentExpected> {
  const seconds = spec.seconds ?? 0;
  return {
    assertions: {},
    attributes: { [TURN_SECONDS_ATTRIBUTE]: seconds },
    evaluator_failures: [],
    ...casedTurn(spec),
    labels: {},
    metrics: {},
    name: spec.name,
    scores: scoreResults(spec.scores),
    span_id: null,
    task_duration: seconds + QUEUED_SECONDS,
    total_duration: seconds + QUEUED_SECONDS,
    trace_id: null,
  };
}

export function makeCannedReport(specs: readonly CannedCaseSpec[]): AgentEvalReport {
  return {
    analyses: [],
    cases: specs.map(makeCannedCase),
    failures: [],
    name: 'canned',
    report_evaluator_failures: [],
    span_id: null,
    trace_id: null,
  };
}

function scoreResults(scores: MetricRecord): Record<string, EvaluationResultJson> {
  const results = Object.entries(scores).map(([name, value]) => [
    name,
    { name, reason: null, source: { name, arguments: null }, value },
  ]);
  return Object.fromEntries(results) as Record<string, EvaluationResultJson>;
}
