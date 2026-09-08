/**
 * The SD-9 frames one running turn pushes to whoever is connected (card #1252,
 * spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三 "若有连接在则按 SD-9
 * 帧推 SSE").
 *
 * SD-9 is the AI SDK UI message-stream protocol (frontend-rebuild spec §"Global
 * convention: Chat streaming protocol"), so the wire shapes here are not a
 * design decision of this card — they are read off the RECORDED captures the web
 * suite replays, `apps/agent/tests/fixtures/chat_stream/*.sse`, which is also
 * what `apps/web`'s `use-chat-session.ts` feeds to `@ai-sdk/react`. Every frame
 * below appears verbatim in one of those files, including the `data:`-only
 * framing (the protocol carries its discriminator INSIDE the JSON, so an SSE
 * `event:` line would be a second, contradictory one).
 *
 * THE ANSWER RIDES THE SAME FRAMES (#1283). A succeeded turn closes on TWO
 * `data-response` parts under one shared id — the intent alone, then the whole
 * part — which is `chat_stream_frames.data_frames` and is exactly what the
 * captures record. The id is what makes the pair legal rather than a
 * contradiction: SD-9 data parts are OVERWRITTEN in place by id, so the first is
 * the skeleton the web renders while the second is still being built
 * (`apps/web`'s `isIntentOnly`).
 *
 * THE `respond` TOOL IS INVISIBLE HERE, and that is the captures' shape too:
 * Python's final-result tool never became a tool part either — pydantic-ai's
 * `FinalResultEvent` was projected onto the intent-only data part instead
 * (`output_progress_bridge`). A turn's answer is an answer, not a tool call the
 * user watches.
 *
 * Frames are never persisted (§三: "订阅者**不持久化**"). They are a live view
 * of a turn whose truth is in Neon.
 */
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import { serverStepOrigin } from "@animichi/contract/agent-step-origin";
import { ANSWER_TOOL_NAME } from "@animichi/contract/agent-tool-schemas";
import { isJsonRecord } from "../json-record.ts";
import type { TurnState } from "./run-machine.ts";
import type { TurnAnswer } from "./turn-answer.ts";
import { chatResponsePart } from "./turn-answer-part.ts";
import { asJsonValue } from "./turn-store.ts";

/** One decoded frame; the channel encodes it as `data: <json>`. */
export type TurnFrame = Record<string, JsonValue>;

/** The stream terminator, which is a bare token rather than JSON. */
export const DONE_FRAME = "[DONE]";

/** The id both answer parts share, so the second overwrites the first —
 * verbatim from Python's `RESPONSE_DATA_ID`. */
export const RESPONSE_DATA_ID = "response";

/** The client-facing failure text, verbatim from the Python `_ERROR_TEXT`. */
export const ERROR_TEXT = "Something went wrong. Please try again.";

/** The frames that open every stream: the message, then its first step. */
export function openingFrames(): TurnFrame[] {
  return [{ type: "start" }, { type: "start-step" }];
}

/**
 * An untrusted runtime value as the protocol carries it. pi types a tool's
 * arguments and result as `any`; the frames are JSON either way, so the one
 * narrowing happens here rather than at four call sites.
 */
function jsonOf(value: unknown): JsonValue {
  return value === undefined ? null : (value as JsonValue);
}

/** A tool's structured payload, as `tool-output-available` carries it. */
function outputOf(result: unknown): JsonValue {
  return jsonOf(isJsonRecord(result) ? result.details : null);
}

function toolInputFrames(event: Extract<AgentEvent, { type: "tool_execution_start" }>): TurnFrame[] {
  const { toolCallId, toolName } = event;
  return [
    { type: "tool-input-start", toolCallId, toolName },
    { type: "tool-input-available", toolCallId, toolName, input: jsonOf(event.args) },
  ];
}

function toolOutputFrames(event: Extract<AgentEvent, { type: "tool_execution_end" }>): TurnFrame[] {
  const { toolCallId } = event;
  if (event.isError) return [{ type: "tool-output-error", toolCallId, errorText: ERROR_TEXT }];
  return [{ type: "tool-output-available", toolCallId, output: outputOf(event.result) }];
}

/** The frames one pi agent event becomes; most events become none. */
export function framesFor(event: AgentEvent): TurnFrame[] {
  if (event.type === "tool_execution_start") {
    return event.toolName === ANSWER_TOOL_NAME ? [] : toolInputFrames(event);
  }
  if (event.type === "tool_execution_end") {
    return event.toolName === ANSWER_TOOL_NAME ? [] : toolOutputFrames(event);
  }
  return [];
}

/**
 * The frames a SERVER-initiated step pushes (card #1288).
 *
 * A deterministic selection has no pi events to translate, so the two shapes
 * `framesFor` derives from `tool_execution_start` / `_end` are built directly
 * — which is what Python's `ToolPartTranslator` did with its own `StepEvent`s,
 * under a call id it minted itself (`new_step_call_id`). The opening `input` is
 * `{}` because a selection's arguments came from the request rather than from a
 * model, exactly as Python emitted `_emit(on_step, call_id, tool, "running",
 * {})`.
 *
 * AND THE OPENING FRAME SAYS SO (#1462). That empty `input` is the runtime's
 * honest answer and it is also indistinguishable, on the frames alone, from a
 * model that called a tool with no arguments — which made
 * `argument_correctness` read 0.0 on every successful bypass turn for a reason
 * that says nothing about the agent. `serverStepOrigin()` is the marker Python
 * already had as `StepRecord.model_initiated`; see
 * `@animichi/contract/agent-step-origin` for why it rides in `toolMetadata` and
 * why absence still means the model asked.
 */
export function serverStepOpened(callId: string, toolName: string): TurnFrame[] {
  return [
    { type: "tool-input-start", toolCallId: callId, toolName, ...serverStepOrigin() },
    { type: "tool-input-available", toolCallId: callId, toolName, input: {} },
  ];
}

/**
 * The step's own outcome word, as its output part.
 *
 * Python published `{"route_ref": …}` / `{"result_ref": …}` on the successful
 * branches and `{"status": …}` on the rest. The refs are dropped here: a ref is
 * a SERVER-side handle into the turn's registry, no client reads one (the web
 * renders the `data-response` part, and these frames drive the tool theater),
 * and minting one into a frame before the answer has stored its payload would
 * publish a handle that does not resolve. The status is the fact the theater
 * actually shows.
 */
export function serverStepSettled(callId: string, status: string): TurnFrame[] {
  return [{ type: "tool-output-available", toolCallId: callId, output: { status } }];
}

/** A step that could not do its work — Python's `_error` translation. */
export function serverStepFailed(callId: string): TurnFrame[] {
  return [{ type: "tool-output-error", toolCallId: callId, errorText: ERROR_TEXT }];
}

/** One overwritable data part under the shared response id. */
function dataResponse(data: JsonValue): TurnFrame {
  return { type: "data-response", id: RESPONSE_DATA_ID, data };
}

/** The intent first, then the whole part — Python's `data_frames`. */
export function answerFrames(answer: TurnAnswer): TurnFrame[] {
  return [dataResponse({ intent: answer.intent }), dataResponse(asJsonValue(chatResponsePart(answer)))];
}

/** The frames that close a stream, told apart by how the turn ended. */
export function closingFrames(state: TurnState, answer: TurnAnswer): TurnFrame[] {
  if (state.phase === "succeeded") {
    return [...answerFrames(answer), { type: "finish-step" }, { type: "finish", finishReason: "stop" }];
  }
  return [
    { type: "error", errorText: ERROR_TEXT },
    { type: "finish-step" },
    { type: "finish", finishReason: "error" },
  ];
}
