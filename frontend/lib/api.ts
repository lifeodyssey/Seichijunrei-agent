import type {
  ConversationRecord,
  RuntimeRequest,
  RuntimeResponse,
} from "./types";
import { getSupabaseClient } from "./supabase";

const RUNTIME_URL =
  (process.env.NEXT_PUBLIC_RUNTIME_URL ?? "").replace(/\/$/, "");

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

export async function sendMessageStream(
  text: string,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
  onStep?: (tool: string, status: "running" | "done") => void,
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
    const messages = chunk.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const line of messages) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice("data:".length).trim();
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { event?: string; tool?: string; status?: "running" | "done"; message?: string };
      if (parsed.event === "step" && parsed.tool && parsed.status) {
        onStep?.(parsed.tool, parsed.status);
      }
      if (parsed.event === "done") {
        const { event: _event, ...response } = parsed;
        return response as RuntimeResponse;
      }
      if (parsed.event === "error") {
        throw new Error(parsed.message ?? "Stream error");
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
