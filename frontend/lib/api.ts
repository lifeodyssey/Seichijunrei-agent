import type { RuntimeRequest, RuntimeResponse } from "./types";
import { supabase } from "./supabase";

const RUNTIME_URL =
  (process.env.NEXT_PUBLIC_RUNTIME_URL ?? "").replace(/\/$/, "");

async function getAuthHeaders(): Promise<Record<string, string>> {
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
