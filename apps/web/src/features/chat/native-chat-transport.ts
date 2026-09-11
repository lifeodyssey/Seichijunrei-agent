import { AnonLimitErrorEnvelope, readQuotaResetsAt } from "@animichi/contract";
import { DefaultChatTransport } from "ai";
import type { PrepareSendMessagesRequest } from "ai";
import type { RefObject } from "react";
import { z } from "zod";
import { authHeaders } from "../../lib/auth/auth-session";
import { sessionHeaders } from "./session-headers";
import { turnKeyOf } from "./use-chat-session";
import type { ChatUIMessage } from "./use-chat-session";

export interface SessionTracker {
  scope: string;
  id: string | undefined;
  operationId: string | undefined;
  streamActivity: number;
  revision: number | undefined;
  digest: string | undefined;
  lastHttpStatus: number | undefined;
  lastErrorCode: string | undefined;
  lastQuotaResetsAt: string | undefined;
}
type SessionRef = RefObject<SessionTracker>;

function offerOf(ref: SessionRef) {
  return { sessionId: ref.current.id, revision: ref.current.revision, digest: ref.current.digest };
}

/** The rejection envelope's shape, as far as classification needs it. */
interface RejectionDetail {
  readonly code: string | undefined;
  readonly quotaResetsAt: string | undefined;
}

const NO_REJECTION: RejectionDetail = { code: undefined, quotaResetsAt: undefined };

const RejectionCodeEnvelope = z.object({ error: z.object({ code: z.string() }) });

/**
 * Read the rejection's error code — which separates D8 (401/403 expiry) from
 * D11 (`anon_budget_exhausted`) and D12 (`anon_quota_exhausted`) — plus D12's
 * `quota_resets_at`, read through the shared contract. Only failures are
 * parsed; a streaming 2xx body is never touched, let alone buffered.
 */
async function readRejection(response: Response): Promise<RejectionDetail> {
  if (response.ok) return NO_REJECTION;
  const body: unknown = await response.clone().json().catch(() => undefined);
  const limit = AnonLimitErrorEnvelope.safeParse(body);
  const rejection = RejectionCodeEnvelope.safeParse(body);
  const code = limit.success ? limit.data.error.code : rejection.data?.error.code;
  return { code, quotaResetsAt: readQuotaResetsAt(body) };
}

function clearRejection(ref: SessionRef): void {
  ref.current.lastHttpStatus = undefined;
  ref.current.lastErrorCode = undefined;
  ref.current.lastQuotaResetsAt = undefined;
}

function recordRejection(ref: SessionRef, response: Response, rejection: RejectionDetail): void {
  ref.current.lastErrorCode = rejection.code;
  ref.current.lastQuotaResetsAt = rejection.quotaResetsAt;
  ref.current.lastHttpStatus = response.status;
}

/** Record each chat response's status and rejection detail so failures classify. */
function createTrackingFetch(ref: SessionRef, notify: () => void): typeof globalThis.fetch {
  return async (input, init) => {
    const scope = ref.current.scope;
    clearRejection(ref);
    return trackedResponse(ref, scope, await globalThis.fetch(input, init), notify);
  };
}

async function trackedResponse(ref: SessionRef, scope: string, response: Response, notify: () => void) {
  const rejection = await readRejection(response);
  if (ref.current.scope !== scope) return response;
  recordRejection(ref, response, rejection);
  captureNativeIdentity(ref, response);
  return observedResponse(response, () => {
    if (ref.current.scope !== scope) return;
    ref.current.streamActivity = Date.now(); notify();
  });
}

type OutgoingTurn = Parameters<PrepareSendMessagesRequest<ChatUIMessage>>[0];

function headerEntries(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

/** Rebuild the default request wire shape, adding the message-derived key. */
async function prepareTurnRequest(ref: SessionRef, turn: OutgoingTurn) {
  return {
    body: { ...turn.body, id: turn.id, messages: turn.messages, trigger: turn.trigger, messageId: turn.messageId },
    headers: {
      ...headerEntries(turn.headers),
      ...await sessionHeaders({ ...offerOf(ref), turnId: turnKeyOf(turn.messages) }),
    },
  };
}

export function createSessionTransport(chatUrl: string, ref: SessionRef, notify: () => void): DefaultChatTransport<ChatUIMessage> {
  return new DefaultChatTransport({
    api: chatUrl,
    fetch: createTrackingFetch(ref, notify),
    prepareReconnectToStreamRequest: ({ requestMetadata }) => reconnectRequest(chatUrl, ref, requestMetadata),
    prepareSendMessagesRequest: (turn) => prepareTurnRequest(ref, turn),
  });
}


function captureNativeIdentity(ref: SessionRef, response: Response): void {
  if (!response.ok) return;
  const sessionId = response.headers.get("x-session-id");
  const operationId = response.headers.get("x-operation-id");
  if (sessionId) ref.current.id = sessionId;
  if (operationId) ref.current.operationId = operationId;
}

/** Observe network activity without decoding, buffering or rewriting the SDK stream. */
function observedResponse(response: Response, activity: () => void): Response {
  activity();
  if (!response.ok || !response.body) return response;
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { activity(); controller.enqueue(chunk); },
  }));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function reconnectRequest(chatUrl: string, ref: SessionRef, metadata: unknown) {
  const sessionId = ref.current.id;
  if (!sessionId) throw new Error("A native session is required to reconnect");
  const url = new URL(chatUrl);
  url.pathname = `/v1/conversations/${encodeURIComponent(sessionId)}/stream`;
  url.search = "";
  if (ref.current.operationId && !z.object({ latest: z.literal(true) }).safeParse(metadata).success) url.searchParams.set("operation_id", ref.current.operationId);
  return { api: url.toString(), headers: await authHeaders() };
}
