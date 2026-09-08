/**
 * One staging turn, read back off the wire as the eight eval evaluators need it
 * (W3-2 #1300, spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §五:
 * "工具轨迹从 SSE/GET 转录取，不依赖 span tree").
 *
 * THE TRAJECTORY COMES FROM THE FRAMES, NOT FROM A SPAN TREE. Python's
 * evaluators read `AgentResult.steps` — records the in-process runner built as
 * it went. Nothing equivalent crosses the network, and pydantic-evals' official
 * adapters reach for OTel spans that a laptop driving staging over HTTP does not
 * have either. What the deployed edge DOES publish is the SD-9 frames
 * (`workers/edge/src/agent/session/turn-frames.ts`): `tool-input-start` names
 * the tool, `tool-input-available` carries its arguments, and a
 * `tool-output-available` / `-error` under the same `toolCallId` says how it
 * ended. That is the same fact `StepRecord` holds, published rather than
 * remembered.
 *
 * THE PARAMS COME FROM THE TRANSCRIPT READ, AND THAT IS THE POINT (E-2 #1381,
 * owner decision #1311). A frame's `input` is the model's own account of the
 * call; `StepRecord.params` is what the runtime settled that account into, and
 * `ArgumentCorrectness` scores one against the other. Taking both off the
 * stream would make the metric compare a self-statement with itself, so the
 * second record is read from `GET /v1/conversations/{id}/messages`, where the
 * edge publishes the params each tool actually ran with.
 *
 * WHAT THIS TYPE MAY CARRY is bounded by that: exactly the members
 * `evaluators.py` and `official_evaluators.py` read off an `AgentResult`
 * (`_actual_tools`, `_available_data_keys`, `ctx.output.message`,
 * `len(ctx.output.steps)`, each step's `params`), and nothing the wire cannot
 * answer. A member this shaper had to invent would be a metric scored against
 * a guess.
 *
 * Pure: no network, no clock, no environment. The reading is here; the
 * requesting is `staging-turn-task.ts`.
 */
import { type AgentStepOrigin, stepOriginOf } from "@animichi/contract/agent-step-origin";
import type { GetSessionHistoryResponse } from "@animichi/contract/session-history-contract";

import { dataKeysOf } from "./answer-data-keys.ts";
import { objectOrNull } from "./json-object.ts";
import { paramsRecordedIn, settledSteps, withSettledParams } from "./settled-params.ts";

/** One decoded SD-9 frame. The protocol carries its discriminator inside the
 * JSON, so a frame is a bare object and `type` is just one of its members. */
export type TurnFrame = Readonly<Record<string, unknown>>;

/**
 * The members of the answer part the evaluators read.
 *
 * Named after `ChatResponseDataPart` (`packages/contract/src/chat-data-parts.ts`)
 * but not PARSED with it, and that is a decision rather than a shortcut. The
 * contract's union is `.strict()`, so one additive member on a future staging
 * deploy would fail the parse — and a shaper that answered `null` there would
 * report a turn that answered fine as a turn that crashed, which is a false
 * measurement rather than a caught bug. Holding the edge to the strict shape is
 * `packages/contract/test/chat-answer-part.test.ts`'s job, where a failure means
 * what it says.
 */
export interface AnswerPart {
  readonly intent: string;
  readonly success: boolean;
  readonly message: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * How a tool call ended.
 *
 * Three states, not two, because the wire distinguishes three. Python's
 * `StepRecord.is_success` is a boolean only because a call the in-process runner
 * never finished produced no record at all; a stream can be cut off mid-call and
 * still have told us the call was MADE. Collapsing that into `error` would
 * report a tool failure that never happened, and into `ok` would let
 * `ArgumentCorrectness` score arguments against an answer nobody saw. W3-3's
 * port of that evaluator filters on `"ok"`, which is `is_success` exactly.
 */
export type StepStatus = "ok" | "error" | "unsettled";

/**
 * One tool call, in the shape `ArgumentCorrectness` / `ToolCorrectness` /
 * `TrajectoryMatch` compare: the name, the arguments it was called with, what
 * it ran with, and whether it succeeded. A call with no output frame at all
 * stays `"ok"` only when one arrived; see `stepStatus`.
 *
 * `args` and `params` are the SAME call from two authors, which is the whole
 * point of the pair (#1381): `args` is the model's own account, off the stream,
 * and `params` is what the runtime settled it into, off the transcript read.
 * `params` is `null` when that read published no settled step for this call —
 * `StepRecord.params_recorded=False`, said in a way that cannot be mistaken for
 * a call made with no arguments.
 *
 * `output` is the RETURN, the one member here no Python evaluator reads (E-3
 * #1382, spec §十 10.3). It is `tool-output-available.output`, which the edge
 * fills with the outcome's `details` and nothing else
 * (`session/turn-frames.ts::outputOf`), so it is `catalog-tool-outcomes.ts`'
 * vocabulary verbatim. The final-reply verifier needs it because a claim is
 * traceable against what came BACK and name/args/status say only what was
 * asked; `null` is a call the stream never settled, not an empty return.
 *
 * `origin` is `StepRecord.model_initiated`, published (#1462): a deterministic
 * bypass is opened by the RUNTIME with `input: {}`, so its two witnesses can
 * never agree and `argument_correctness` scored it 0.0 on every successful
 * bypass turn. `evaluators/transcript-view.ts::modelAsked` is the filter Python
 * has always applied (`official_evaluators.py:77-81`).
 */
export interface TranscriptStep {
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly params: Readonly<Record<string, unknown>> | null;
  readonly status: StepStatus;
  readonly output: Readonly<Record<string, unknown>> | null;
  readonly origin: AgentStepOrigin;
}

/** The status of the run that produced this transcript, per `GET /v1/conversations/{id}/messages`. */
export type RunStatus = "running" | "succeeded" | "failed";

/** One turn as the evaluators read it — Python's `AgentResult`, off the wire. */
export interface TranscriptResult {
  readonly intent: string;
  readonly success: boolean;
  readonly message: string;
  readonly locale: string;
  readonly dataKeys: readonly string[];
  readonly stepCount: number;
  readonly trajectory: readonly TranscriptStep[];
  /** The calls of the session's EARLIER turns, which this turn's model read
   * back (`prior-turn-returns.ts`, §九 9.1). Apart from `trajectory` on
   * purpose: folding them in would move eight metrics to feed one. */
  readonly priorTrajectory: readonly TranscriptStep[];
  /**
   * Whether the transcript read offered a second record for these calls at all
   * (`settled-params.ts::paramsRecordedIn`). False makes `argument_correctness`
   * emit no metric, which is what "unmeasured" has to look like next to a real
   * zero.
   */
  readonly paramsRecorded: boolean;
  readonly response: AnswerPart | null;
  readonly runStatus: RunStatus | null;
}

/** The stream terminator, which is a bare token rather than JSON. */
const DONE_FRAME = "data: [DONE]";
const DATA_PREFIX = "data: ";

/** The id both `data-response` parts share; the second overwrites the first. */
const RESPONSE_DATA_ID = "response";

/** The intent a turn that crashed carries. The contract has a member for it
 * (`ChatResponseDataPart`'s `error`), Python had no `AgentResult` at all, and
 * an evaluator must be able to tell "answered nothing" from "answered".
 *
 * Exported because `gate-run/provider-outage.ts` counts the cases that carry it
 * (#1496). A second copy of the literal there would keep counting the old
 * sentinel — silently zero — the day this one moved. */
export const CRASHED_INTENT = "error";

/** The frames of one `text/event-stream` body, in order. */
export function turnFramesOf(stream: string): readonly TurnFrame[] {
  return stream
    .split("\n")
    .filter((line) => line.startsWith(DATA_PREFIX) && line !== DONE_FRAME)
    .map((line) => JSON.parse(line.slice(DATA_PREFIX.length)) as TurnFrame);
}

function frameString(frame: TurnFrame, key: string): string | null {
  const value = frame[key];
  return typeof value === "string" ? value : null;
}

function frameRecord(frame: TurnFrame, key: string): Readonly<Record<string, unknown>> {
  return objectOrNull(frame[key]) ?? {};
}

/** The calls this stream opened, keyed by the id their output frames name.
 * A call starts `"unsettled"` and only its own output frame moves it. */
function openedCalls(frames: readonly TurnFrame[]): Map<string, TranscriptStep> {
  const calls = new Map<string, TranscriptStep>();
  for (const frame of frames.filter((item) => item.type === "tool-input-start")) {
    const callId = frameString(frame, "toolCallId");
    const toolName = frameString(frame, "toolName");
    if (callId === null || toolName === null) continue;
    const origin = stepOriginOf(frame);
    calls.set(callId, { toolName, args: {}, params: null, status: "unsettled", output: null, origin });
  }
  return calls;
}

/** The call as a settling frame leaves it, or nothing when it settles nothing.
 * Only the successful branch carries a return: `tool-output-error` publishes an
 * `errorText` and no `output`, and an errored call answered nothing. */
function settledCall(opened: TranscriptStep, frame: TurnFrame): TranscriptStep | null {
  if (frame.type === "tool-output-available") {
    return { ...opened, status: "ok", output: frameRecord(frame, "output") };
  }
  return frame.type === "tool-output-error" ? { ...opened, status: "error" } : null;
}

/** One later frame folded onto the call it names; anything else is ignored. */
function foldFrame(calls: Map<string, TranscriptStep>, frame: TurnFrame): void {
  const callId = frameString(frame, "toolCallId");
  const opened = callId === null ? undefined : calls.get(callId);
  if (callId === null || opened === undefined) return;
  if (frame.type === "tool-input-available") {
    calls.set(callId, { ...opened, args: frameRecord(frame, "input") });
    return;
  }
  const settled = settledCall(opened, frame);
  if (settled !== null) calls.set(callId, settled);
}

/**
 * The call order the trajectory is scored in.
 *
 * Order is `tool-input-start`'s, because that is when the call was MADE. The
 * outputs arrive in completion order, and the edge runs a turn's tools
 * sequentially today — but scoring `TrajectoryMatch(order="in_order")` off
 * completion order would silently start disagreeing with Python the first time
 * two tools overlap.
 */
export function trajectoryOf(frames: readonly TurnFrame[]): readonly TranscriptStep[] {
  const calls = openedCalls(frames);
  for (const frame of frames) foldFrame(calls, frame);
  return [...calls.values()];
}

/** The whole answer part, or null when the turn never produced one. */
export function answerOf(frames: readonly TurnFrame[]): AnswerPart | null {
  const parts = frames.filter((frame) => frame.type === "data-response" && frame.id === RESPONSE_DATA_ID);
  const last = parts.at(-1);
  const part = last === undefined ? null : frameRecord(last, "data");
  if (part === null || typeof part.intent !== "string") return null;
  return {
    intent: part.intent,
    success: part.success === true,
    message: typeof part.message === "string" ? part.message : "",
    data: frameRecord(part, "data"),
  };
}

/** What one turn produced, and what reading its transcript back added. */
export interface TurnTranscript {
  readonly frames: readonly TurnFrame[];
  /** The calls of the submissions BEFORE the measured one, already read off
   * their own frames (`prior-turn-returns.ts`, §九 9.1). Empty is the ordinary
   * case: most sets carry no recorded history. */
  readonly priorTrajectory: readonly TranscriptStep[];
  readonly history: GetSessionHistoryResponse | null;
  /** The locale the turn was REQUESTED with — see `transcriptResultOf`. */
  readonly locale: string;
}

/**
 * One turn's transcript as the evaluators read it.
 *
 * `locale` is the REQUESTED locale, carried through rather than derived. The
 * answer envelope publishes no locale to derive one from: `session` is `{}` and
 * `ui` is a component name, both constant by contract
 * (`turn-answer-part.ts::capturedMembers`, kept that way so a client cannot
 * tell which tier answered it). Python did not derive one either — `LocaleMatch`
 * reads `ctx.inputs.locale` together with the answer's prose and calls
 * `resolve_reply_language` on the MESSAGE. So the honest members are the locale
 * that was asked for and the prose that came back; W3-3 scores the pair.
 */
export function transcriptResultOf(transcript: TurnTranscript): TranscriptResult {
  const response = answerOf(transcript.frames);
  const calls = trajectoryOf(transcript.frames);
  const trajectory = withSettledParams(calls, settledSteps(transcript.history));
  return {
    intent: response?.intent ?? CRASHED_INTENT,
    success: response?.success ?? false,
    message: response?.message ?? "",
    locale: transcript.locale,
    dataKeys: dataKeysOf(response),
    stepCount: trajectory.length,
    trajectory,
    priorTrajectory: transcript.priorTrajectory,
    paramsRecorded: paramsRecordedIn(transcript.history),
    response,
    runStatus: transcript.history?.run?.status ?? null,
  };
}
