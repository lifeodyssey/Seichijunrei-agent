import type {
  ConversationRecord,
  RuntimeRequest,
  RuntimeResponse,
} from "./types";
import { getSupabaseClient } from "./supabase";

const RUNTIME_URL =
  (process.env.NEXT_PUBLIC_RUNTIME_URL ?? "").replace(/\/$/, "");

const SELECTED_ROUTE_ACTION_TEXT = {
  ja: {
    withOrigin: "{origin}から選択した{count}件のスポットでルートを作成して。",
    withoutOrigin: "選択した{count}件のスポットでルートを作成して。",
  },
  zh: {
    withOrigin: "请从{origin}出发，为我规划这{count}个已选取景地的路线。",
    withoutOrigin: "请为我规划这{count}个已选取景地的路线。",
  },
  en: {
    withOrigin: "Create a route with {count} selected stops from {origin}.",
    withoutOrigin: "Create a route with {count} selected stops.",
  },
} as const;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  if (!supabase) return {};

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Send a user message to the backend runtime and return the typed response.
 * Throws on HTTP errors so the caller can handle display.
 */
export async function sendMessage(
  text: string,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  const body: RuntimeRequest = { text };
  if (sessionId) body.session_id = sessionId;
  if (locale) body.locale = locale;

  const res = await fetch(`${RUNTIME_URL}/v1/runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      errBody?.error?.message ?? `Runtime error (${res.status})`,
    );
  }

  return res.json() as Promise<RuntimeResponse>;
}

export function buildSelectedRouteActionText(
  pointCount: number,
  origin?: string | null,
  locale: RuntimeRequest["locale"] = "ja",
): string {
  const templates = SELECTED_ROUTE_ACTION_TEXT[locale ?? "ja"];
  const normalizedOrigin = origin?.trim();
  const template = normalizedOrigin
    ? templates.withOrigin
    : templates.withoutOrigin;

  return template
    .replace("{count}", String(pointCount))
    .replace("{origin}", normalizedOrigin ?? "");
}

export async function sendSelectedRoute(
  pointIds: string[],
  origin?: string | null,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  const normalizedOrigin = origin?.trim();
  const effectiveLocale = locale ?? "ja";
  const body: RuntimeRequest = {
    text: buildSelectedRouteActionText(pointIds.length, normalizedOrigin, effectiveLocale),
    locale: effectiveLocale,
    selected_point_ids: pointIds,
  };
  if (sessionId) body.session_id = sessionId;
  if (normalizedOrigin) body.origin = normalizedOrigin;

  const res = await fetch(`${RUNTIME_URL}/v1/runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      errBody?.error?.message ?? `Runtime error (${res.status})`,
    );
  }

  return res.json() as Promise<RuntimeResponse>;
}

type StreamEventPayload = {
  event?: string;
  tool?: string;
  status?: "running" | "done";
  message?: string;
} & Record<string, unknown>;

function parseSSEChunk(chunk: string): {
  buffer: string;
  events: Array<{ event?: string; payload: StreamEventPayload }>;
} {
  const normalized = chunk.replace(/\r\n/g, "\n");
  const messages = normalized.split("\n\n");
  const buffer = messages.pop() ?? "";
  const events: Array<{ event?: string; payload: StreamEventPayload }> = [];

  for (const message of messages) {
    const lines = message.split("\n");
    let eventName: string | undefined;
    const dataLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    if (dataLines.length === 0) continue;

    const rawData = dataLines.join("\n").trim();
    if (!rawData) continue;

    let payload: StreamEventPayload;
    try {
      payload = JSON.parse(rawData) as StreamEventPayload;
    } catch (error) {
      if (eventName === "error") {
        throw new Error(rawData);
      }
      throw error;
    }

    events.push({
      event: typeof payload.event === "string" ? payload.event : eventName,
      payload,
    });
  }

  return { buffer, events };
}

export async function sendMessageStream(
  text: string,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  onStep?: (tool: string, status: "running" | "done", thought?: string, observation?: string) => void,
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  const body: RuntimeRequest = { text };
  if (sessionId) body.session_id = sessionId;
  if (locale) body.locale = locale;

  const res = await fetch(`${RUNTIME_URL}/v1/runtime/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const errBody = await res.json().catch(() => null);
    throw new Error(
      errBody?.error?.message ?? `Stream error (${res.status})`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (chunk: string): RuntimeResponse | null => {
    const parsedChunk = parseSSEChunk(chunk);
    buffer = parsedChunk.buffer;

    for (const { event, payload } of parsedChunk.events) {
      if (event === "step" && payload.tool && payload.status) {
        onStep?.(
          payload.tool,
          payload.status,
          typeof payload.thought === "string" ? payload.thought : undefined,
          typeof payload.observation === "string" ? payload.observation : undefined,
        );
      }
      if (event === "done") {
        if (typeof payload.event === "string") {
          const { event: _event, ...response } = payload;
          return response as unknown as RuntimeResponse;
        }
        return payload as unknown as RuntimeResponse;
      }
      if (event === "error") {
        throw new Error(
          typeof payload.message === "string" ? payload.message : "Stream error",
        );
      }
    }
    return null;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = consume(buffer);
    if (parsed) return parsed;
  }

  buffer += decoder.decode();
  const parsed = consume(buffer);
  if (parsed) return parsed;

  throw new Error("Stream ended without done event");
}

/**
 * Submit user feedback (thumbs up/down) for a response.
 */
export async function submitFeedback(params: {
  session_id?: string | null;
  query_text: string;
  intent: string;
  rating: "good" | "bad";
  comment?: string;
}): Promise<{ feedback_id: string }> {
  const res = await fetch(`${RUNTIME_URL}/v1/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(`Feedback submission failed (${res.status})`);
  }

  return res.json();
}

export async function fetchConversations(): Promise<ConversationRecord[]> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) return [];

  const res = await fetch(`${RUNTIME_URL}/v1/conversations`, {
    headers: authHeaders,
  });

  if (!res.ok) return [];
  return res.json() as Promise<ConversationRecord[]>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  data: Record<string, unknown> | null;
  timestamp: string;
}

export async function fetchConversationMessages(
  sessionId: string,
): Promise<ConversationMessage[]> {
  const res = await fetch(
    `${RUNTIME_URL}/v1/conversations/${encodeURIComponent(sessionId)}/messages`,
    { headers: await getAuthHeaders() },
  );

  if (!res.ok) return [];
  const data: { messages: Array<{ role: string; content: string; response_data: Record<string, unknown> | null; created_at: string }> } = await res.json();
  return data.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
    data: m.response_data,
    timestamp: m.created_at,
  }));
}

export interface RouteHistoryEntry {
  id: string;
  bangumi_id: string;
  bangumi_title: string | null;
  origin_station: string | null;
  point_count: number;
  created_at: string;
}

export async function fetchRouteHistory(): Promise<RouteHistoryEntry[]> {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) return [];

  const res = await fetch(`${RUNTIME_URL}/v1/routes`, {
    headers: authHeaders,
  });

  if (!res.ok) return [];
  const data: { routes: RouteHistoryEntry[] } = await res.json();
  return data.routes;
}

export async function patchConversationTitle(
  sessionId: string,
  title: string,
): Promise<void> {
  const res = await fetch(
    `${RUNTIME_URL}/v1/conversations/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify({ title }),
    },
  );

  if (!res.ok) {
    throw new Error(`Rename failed (${res.status})`);
  }
}
