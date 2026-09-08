/**
 * One measured turn built around WHERE IT WENT WRONG (E-4 #1383).
 *
 * The three first-error signals read three different parts of a turn — the
 * completed calls against the case's accepted chains, each call's settled
 * status, and the reply's prose — so a fixture for them has to vary exactly one
 * of those at a time. `stages` is what decides the accepted chains
 * (`evaluators/accepted-chains.ts`), so it is a member here rather than a
 * hard-coded `[]`; `makeReplyTurn` (E-3) covers the reply-source side and names
 * its tools after the sources instead.
 */
import type { AgentStepOrigin } from '@animichi/contract/agent-step-origin';

import type { ExportedAgentExpected, ExportedAgentInput } from '../src/dataset-roundtrip.ts';
import type { StepStatus, TranscriptResult, TranscriptStep } from '../src/turn-transcript.ts';

export interface StepSpec {
  readonly tool: string;
  /** Defaults to `"ok"` — the only status a chain position is made of. */
  readonly status?: StepStatus;
  /** The outcome `details` the call published, a claim source. */
  readonly output?: Readonly<Record<string, unknown>>;
  /** What the model asked for, off the stream. */
  readonly args?: Readonly<Record<string, unknown>>;
  /** What the runtime settled it into, off the transcript read. DEFAULTS TO
   * `args`: a call the two witnesses agree on, which is `argument_correctness`
   * scoring 1. A test about `wrong_arguments` is the one that sets it apart —
   * leaving `params` null by default would make every clean turn look
   * mis-argued (`OfficialArgumentCorrectness` scores an unwitnessed call 0). */
  readonly params?: Readonly<Record<string, unknown>> | null;
  /** Who asked for the call (#1462). Defaults to the model, which is what every
   * call on the wire is unless its opening frame said otherwise. */
  readonly origin?: AgentStepOrigin;
}

export interface AttributedTurnParts {
  readonly steps?: readonly StepSpec[];
  /** `metadata.acceptable_stages`: what the case's chains are derived from. */
  readonly stages?: readonly string[];
  readonly message?: string;
  readonly query?: string;
  /** The answer part's `data`; rows are what make a name claim decidable. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface AttributedTurn {
  readonly inputs: ExportedAgentInput;
  readonly metadata: ExportedAgentExpected;
  readonly output: TranscriptResult;
}

/** Rows enough for a name claim to be judged at all (`rowsPublished`). */
export const PUBLISHED_ROWS = { results: { row_count: 1, rows: [{ name: '宇治橋' }] } };

const INTENT = 'search_bangumi';

function transcriptStep(spec: StepSpec): TranscriptStep {
  const status = spec.status ?? 'ok';
  const args = spec.args ?? {};
  return {
    toolName: spec.tool,
    args,
    params: spec.params === undefined ? args : spec.params,
    status,
    output: status === 'ok' ? (spec.output ?? {}) : null,
    origin: spec.origin ?? 'model',
  };
}

function turnInputs(parts: AttributedTurnParts): ExportedAgentInput {
  return {
    clarification_id: null,
    context: null,
    locale: 'ja',
    query: parts.query ?? '聖地を教えて',
    seeded_pending: null,
    selected_candidate_ids: null,
    selected_point_ids: null,
  };
}

function turnOutput(parts: AttributedTurnParts, trajectory: TranscriptStep[]): TranscriptResult {
  const message = parts.message ?? '';
  return {
    intent: INTENT,
    success: true,
    message,
    locale: 'ja',
    dataKeys: [],
    stepCount: trajectory.length,
    trajectory,
    priorTrajectory: [],
    paramsRecorded: true,
    response: { intent: INTENT, success: true, message, data: parts.data ?? {} },
    runStatus: 'succeeded',
  };
}

export function makeAttributedTurn(parts: AttributedTurnParts): AttributedTurn {
  return {
    inputs: turnInputs(parts),
    metadata: {
      acceptable_stages: [...(parts.stages ?? [])],
      data_keys: [],
      expect_nonempty: true,
    },
    output: turnOutput(parts, (parts.steps ?? []).map(transcriptStep)),
  };
}
