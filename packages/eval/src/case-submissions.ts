/**
 * The chat bodies one eval case submits, in the order they must be sent.
 *
 * Python's task handed `run_animichi_agent` an in-process `message_history`
 * (`agent_eval_cases.message_history`) and seeded session state directly. Over
 * HTTP neither is possible: the transcript belongs to the session, and the only
 * way to put a prior turn in it is to have taken that turn. So a case with
 * `context.message_history` becomes N+1 submissions on ONE session id — its
 * history turns, then the case's own query.
 *
 * WHAT THAT CHANGES, stated rather than hidden: the recorded `assistant` half of
 * each history turn is NOT what staging will have replied. The dataset's history
 * is a fixture of a conversation; a replay produces the real agent's answers to
 * the same prompts. The user side — which is what the padding, the topic drift
 * and the anime identity in `long_context_v1` are actually testing — is
 * reproduced exactly, including `padding_chars`.
 *
 * `context.last_search_data` and `context.last_location` are gone (#1398). They
 * had no wire form, and no reader on the Python side either, so the 76 cases
 * that carried one were already running from an empty session in both
 * harnesses. `context` is now `message_history` and `origin_lat`/`origin_lng`.
 */
import type { ExportedAgentInput } from "./dataset-roundtrip.ts";

/** Python's filler sentence, verbatim from `agent_eval_cases._padded_text`. */
const PADDING_SENTENCE = " Travel planning context remains unchanged.";

/** One `POST /v1/chat` body. */
export type ChatSubmission = Readonly<Record<string, unknown>>;

function textOf(turn: Readonly<Record<string, unknown>>, key: string): string {
  const value = turn[key];
  return typeof value === "string" ? value : "";
}

/** Python's `_padded_text`: the turn's text plus exactly `padding_chars` more. */
function paddedText(turn: Readonly<Record<string, unknown>>): string {
  const count = typeof turn.padding_chars === "number" ? turn.padding_chars : 0;
  if (count <= 0) return textOf(turn, "user");
  const repeats = Math.ceil(count / PADDING_SENTENCE.length);
  return textOf(turn, "user") + PADDING_SENTENCE.repeat(repeats).slice(0, count);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The user prompts this case's recorded history replays, in order. */
export function historyPromptsOf(context: ExportedAgentInput["context"]): readonly string[] {
  const raw = context?.message_history;
  if (!Array.isArray(raw)) return [];
  return (raw as readonly unknown[]).filter(isRecord).map(paddedText);
}

/** The visitor's message, in the envelope `apps/web` sends. */
function messageEnvelope(text: string): ChatSubmission {
  return { messages: [{ role: "user", parts: [{ type: "text", text }] }] };
}

/** The departure point a nearby case carries, as the chat body names it. */
function originMembers(context: ExportedAgentInput["context"]): ChatSubmission {
  const lat = context?.origin_lat;
  const lng = context?.origin_lng;
  if (typeof lat !== "number" || typeof lng !== "number") return {};
  return { origin_lat: lat, origin_lng: lng };
}

/** The deterministic selection this case makes, if it makes one. `#1288` reads
 * points before candidates and a candidate pick needs the id of the question it
 * answers, so both travel with the query rather than in a turn of their own. */
function selectionMembers(inputs: ExportedAgentInput): ChatSubmission {
  return {
    ...(inputs.selected_point_ids === null ? {} : { selected_point_ids: inputs.selected_point_ids }),
    ...(inputs.selected_candidate_ids === null ? {} : { selected_candidate_ids: inputs.selected_candidate_ids }),
    ...(inputs.clarification_id === null ? {} : { clarification_id: inputs.clarification_id }),
  };
}

/** Every body this case submits: its history, then the turn under measurement. */
export function caseSubmissionsOf(inputs: ExportedAgentInput): readonly ChatSubmission[] {
  const history = historyPromptsOf(inputs.context).map(messageEnvelope);
  const measured = {
    ...messageEnvelope(inputs.query),
    ...originMembers(inputs.context),
    ...selectionMembers(inputs),
  };
  return [...history, measured];
}
