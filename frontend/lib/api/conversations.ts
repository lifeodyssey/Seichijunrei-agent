import type { ConversationRecord } from "../types";
import { RUNTIME_URL, getAuthHeaders, parseResponseData } from "./client";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  data: Record<string, unknown> | null;
  timestamp: string;
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

export async function fetchConversationMessages(
  sessionId: string,
): Promise<ConversationMessage[]> {
  const res = await fetch(
    `${RUNTIME_URL}/v1/conversations/${encodeURIComponent(sessionId)}/messages`,
    { headers: await getAuthHeaders() },
  );

  if (!res.ok) return [];
  const data: { messages: Array<{ role: string; content: string; response_data: unknown; created_at: string }> } = await res.json();
  return data.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
    data: parseResponseData(m.response_data),
    timestamp: m.created_at,
  }));
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
