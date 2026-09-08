/**
 * One measured turn, built around the reply it produced (E-3 #1382).
 *
 * The final-reply verifier reads a case's inputs and its shaped turn, so a test
 * for it needs both — and needs to vary exactly one source at a time. Every
 * member below is one of the five traceable sources
 * (`src/evaluators/reply-claim-sources.ts`), which is why they are named after
 * the sources rather than after the wire fields they end up in.
 */
import type { ExportedAgentInput } from "../src/dataset-roundtrip.ts";
import type { TranscriptResult, TranscriptStep } from "../src/turn-transcript.ts";

/** A tool return, as `tool-output-available.output` carries the outcome details. */
export type ToolReturn = Readonly<Record<string, unknown>>;

export interface ReplyTurnParts {
  /** The prose under measurement. */
  readonly message: string;
  /** Source 3: the user's own words this turn. */
  readonly query?: string;
  /** Source 3's other half: the prompts the case's recorded history replays,
   * each one a real `user` message this runner sent on the same session. */
  readonly historyPrompts?: readonly string[];
  /** Source 1: what this run's tools returned. */
  readonly returns?: readonly ToolReturn[];
  /** Source 1, the other end: the arguments a call was made with, as the SSE
   * stream published the model's own account of them. */
  readonly callArguments?: readonly ToolReturn[];
  /** Source 1, the other end again: the arguments a call SETTLED with
   * (`run_steps.input`), which is the value the status bar's retention line
   * quotes back verbatim. */
  readonly settledArguments?: readonly ToolReturn[];
  /** Source 4: what the session's EARLIER turns' tools returned (§九 9.1). */
  readonly priorReturns?: readonly ToolReturn[];
  /** Source 2: the `data` this reply published. `{}` is a prose-only answer. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Source 5: the clarification the case was seeded with, which the
   * `<agent_status>` bar states (§九 9.3). */
  readonly seededPending?: Record<string, unknown> | null;
}

export interface ReplyTurn {
  readonly inputs: ExportedAgentInput;
  readonly output: TranscriptResult;
}

function settledCall(output: ToolReturn, index: number): TranscriptStep {
  return { toolName: `tool_${String(index)}`, args: {}, params: null, status: "ok", output, origin: "model" };
}

/** A call whose ARGUMENTS are what the test is about; it answered nothing
 * nameable. `params` is null on the stream-only side, exactly as a prior run's
 * call is — the settled pairing covers the measured run alone. */
function calledWith(args: ToolReturn, index: number): TranscriptStep {
  return { toolName: `asked_${String(index)}`, args, params: null, status: "ok", output: {}, origin: "model" };
}

function settledWith(params: ToolReturn, index: number): TranscriptStep {
  return { toolName: `settled_${String(index)}`, args: {}, params, status: "ok", output: {}, origin: "model" };
}

function replayedHistory(prompts: readonly string[] | undefined): ExportedAgentInput["context"] {
  if (prompts === undefined) return null;
  return { message_history: prompts.map((user) => ({ user })) };
}

function inputsOf(parts: ReplyTurnParts): ExportedAgentInput {
  return {
    clarification_id: null,
    context: replayedHistory(parts.historyPrompts),
    locale: "ja",
    query: parts.query ?? "聖地を教えて",
    seeded_pending: parts.seededPending ?? null,
    selected_candidate_ids: null,
    selected_point_ids: null,
  };
}

export function makeReplyTurn(parts: ReplyTurnParts): ReplyTurn {
  const data = parts.data ?? {};
  const trajectory = [
    ...(parts.returns ?? []).map(settledCall),
    ...(parts.callArguments ?? []).map(calledWith),
    ...(parts.settledArguments ?? []).map(settledWith),
  ];
  return {
    inputs: inputsOf(parts),
    output: {
      intent: "search_bangumi",
      success: true,
      message: parts.message,
      locale: "ja",
      dataKeys: [],
      stepCount: trajectory.length,
      trajectory,
      priorTrajectory: (parts.priorReturns ?? []).map(settledCall),
      paramsRecorded: true,
      response: { intent: "search_bangumi", success: true, message: parts.message, data },
      runStatus: "succeeded",
    },
  };
}
