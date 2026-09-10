import { Chat, useChat } from "@ai-sdk/react";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ChatResponseDataPart } from "@animichi/contract";
import type { ChatDataPart } from "@animichi/contract";
import { generateId } from "ai";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { RefObject } from "react";
import { assignedSessionIdIn } from "./data-parts";
import { useResendCandidatePick, useSendCandidatePick } from "./selection/candidate-pick-transport";
import type { SelectedPointsBody } from "./selection/use-recompute-turn";
import { createSessionTransport } from "./native-chat-transport";
import type { SessionTracker } from "./native-chat-transport";
import type { SessionOffer } from "./session-headers";

/**
 * Typed UI message: the `data-response` part carries the contract envelope,
 * so streamed frames are schema-validated by the AI SDK before they can
 * overwrite an existing same-ID part (`dataPartSchemas`).
 */
export type ChatUIMessage = UIMessage<unknown, { response: ChatDataPart }>;

// AI SDK 7.x (verified at 7.0.47) looks the schema up by the stripped name
// ("response") when validating whole messages but by the full chunk type ("data-response")
// while streaming, so the schema is registered under both keys.
const dataPartSchemas = {
  response: ChatResponseDataPart,
  "data-response": ChatResponseDataPart,
};

type SessionRef = RefObject<SessionTracker>;

function emptyTracker(scope: string, sessionId: string | undefined): SessionTracker {
  return { scope, id: sessionId, operationId: undefined, streamActivity: 0, ...blankOffer(), ...blankRejection() };
}

function blankOffer(): { revision: undefined; digest: undefined } {
  return { revision: undefined, digest: undefined };
}

function blankRejection(): { lastHttpStatus: undefined; lastErrorCode: undefined; lastQuotaResetsAt: undefined } {
  return { lastHttpStatus: undefined, lastErrorCode: undefined, lastQuotaResetsAt: undefined };
}

function scopeOf(sessionId?: string): string {
  return `chat:${sessionId ?? "draft"}`;
}

/** Track the server-assigned session id, reset whenever the URL identity changes. */
function useSessionTracker(sessionId: string | undefined, scope: string): SessionRef {
  const ref = useRef<SessionTracker>(emptyTracker(scope, sessionId));
  if (ref.current.scope !== scope) {
    ref.current = emptyTracker(scope, sessionId);
  }
  return ref;
}

function captureSessionOffer(ref: SessionRef, part: Readonly<{ data: ChatDataPart }>): void {
  const { revision, session_digest } = part.data;
  const assigned = assignedSessionIdIn(part.data);
  if (assigned !== undefined) ref.current.id = assigned;
  if (typeof revision === "number") ref.current.revision = revision;
  if (typeof session_digest === "string" && session_digest !== "") ref.current.digest = session_digest;
}

/** The Session offer to echo on the next turn (TURN-4 #955). */
function offerOf(ref: SessionRef): SessionOffer {
  return { sessionId: ref.current.id, revision: ref.current.revision, digest: ref.current.digest };
}

/**
 * The turn idempotency key, derived from the outgoing message itself
 * (W1 #1220, replacing the connection-lifecycle `pendingTurnId`): the same
 * message resent — a regenerate after a drop — carries the SAME `x-turn-id`
 * so the server dedups it, while any NEW message (a clarify pick fired while
 * the previous stream never finished included) gets its own fresh key.
 */
export function turnKeyOf(messages: readonly ChatUIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return `turn-${message.id}`;
  }
  return `turn-${generateId()}`;
}

/** Handlers pinned to their scope epoch so a late frame from a previous
 * scope's stream cannot fire the current callback. */
function chatHandlers(scope: string, ref: SessionRef) {
  return {
    onData: (part: { data: ChatDataPart }) => {
      if (ref.current.scope === scope) captureSessionOffer(ref, part);
    },
  };
}

function createScopedChat(chatUrl: string, scope: string, ref: SessionRef, notify: () => void): Chat<ChatUIMessage> {
  return new Chat<ChatUIMessage>({
    id: scope,
    transport: createSessionTransport(chatUrl, ref, notify),
    dataPartSchemas,
    ...chatHandlers(scope, ref),
  });
}


interface ScopedChat {
  scope: string;
  chat: Chat<ChatUIMessage>;
}

/** Stop the outgoing scope's stream before the next scope's chat takes over. */
function switchScopedChat(
  previous: ScopedChat | null,
  chatUrl: string,
  scope: string,
  ref: SessionRef,
  notify: () => void,
): ScopedChat {
  void previous?.chat.stop();
  return { scope, chat: createScopedChat(chatUrl, scope, ref, notify) };
}

function useScopedChat(chatUrl: string, scope: string, ref: SessionRef, notify: () => void): Chat<ChatUIMessage> {
  const holder = useRef<ScopedChat | null>(null);
  if (holder.current === null || holder.current.scope !== scope) {
    holder.current = switchScopedChat(holder.current, chatUrl, scope, ref, notify);
  }
  return holder.current.chat;
}

/**
 * `useChat` over `/v1/chat` (AI SDK UI message stream, spec S1.1 SD-9).
 *
 * The chat instance is scoped to the `?session=` identity: switching sessions
 * stops the previous stream, recreates the Chat, and the construction-time
 * epoch guard drops any frame that still arrives late — an in-flight stream
 * from the previous session can never mix into the next one. The
 * backend-assigned `session_id` from `data-response` frames is fed back into
 * follow-up requests through the transport's `prepareSendMessagesRequest`,
 * which also derives the per-message `x-turn-id` (W1 #1220).
 */
function useTrackerReaders(ref: SessionRef) {
  const operationIdOf = useCallback(() => ref.current.operationId, [ref]);
  const sessionIdOf = useCallback(() => ref.current.id, [ref]);
  const sessionOfferOf = useCallback(() => offerOf(ref), [ref]);
  const lastHttpStatus = useCallback(() => ref.current.lastHttpStatus, [ref]);
  const lastErrorCode = useCallback(() => ref.current.lastErrorCode, [ref]);
  const lastQuotaResetsAt = useCallback(() => ref.current.lastQuotaResetsAt, [ref]);
  return { streamActivity: ref.current.streamActivity, operationIdOf, sessionIdOf, sessionOfferOf, lastHttpStatus, lastErrorCode, lastQuotaResetsAt };
}

/** A part-less turn boundary. Without the marker, AI SDK 7.x (verified at 7.0.47) continues the
 * previous assistant message (`createStreamingUIMessageState` reuses an assistant
 * `lastMessage`) and the same-ID `response` part would overwrite the prior
 * card instead of appending the E1 living-document version. It carries no
 * user utterance — the server must not persist a user row for it (the
 * skip-empty-utterance guard in `persistence.py`, #273 Task 3). */
function recomputeMarker(): ChatUIMessage {
  return { id: `recompute-${generateId()}`, role: "user", parts: [] };
}

type SendHelpers = Pick<UseChatHelpers<ChatUIMessage>, "sendMessage" | "setMessages">;

/**
 * E2 bypass send (issue #273 S1.7): re-submit the conversation with only a
 * `selected_point_ids` body — no new user utterance. AI SDK 7.x (verified at 7.0.47)'s
 * `DefaultChatTransport` merges the per-call body (`{...resolvedBody,
 * ...options.body}`), so the field reaches `_optional_ids` unchanged.
 */
function useSendSelectedPoints({ sendMessage, setMessages }: SendHelpers) {
  return useCallback(
    (body: SelectedPointsBody) => {
      setMessages((current) => [...current, recomputeMarker()]);
      void sendMessage(undefined, { body: { ...body } });
    },
    [sendMessage, setMessages],
  );
}

export function useChatSession(chatUrl: string, sessionId?: string, resume = false) {
  const [, notify] = useReducer((value: number) => value + 1, 0);
  const scope = scopeOf(sessionId);
  const ref = useSessionTracker(sessionId, scope);
  const chat = useScopedChat(chatUrl, scope, ref, notify);
  useEffect(() => () => { void chat.stop(); }, [chat]);
  return useChatSessionHelpers(chat, ref, resume);
}

function useChatSessionHelpers(chat: Chat<ChatUIMessage>, ref: SessionRef, resume: boolean) {
  const helpers = useChat<ChatUIMessage>({ chat, resume });
  return {
    ...helpers,
    sendSelectedPoints: useSendSelectedPoints(helpers),
    sendCandidatePick: useSendCandidatePick(helpers),
    resendCandidatePick: useResendCandidatePick(helpers),
    ...useTrackerReaders(ref),
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
