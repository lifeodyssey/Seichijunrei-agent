"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../lib/types";

interface ConversationSyncDeps {
  messages: ChatMessage[];
  upsertConversation: (sessionId: string, firstQuery: string) => void;
}

function findLatestResponse(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const responseSessionId = message.response?.session_id;
    if (!responseSessionId) continue;
    const firstQuery = index > 0 && messages[index - 1]?.role === "user"
      ? messages[index - 1].text : "";
    return { firstQuery, responseId: message.id, sessionId: responseSessionId };
  }
  return null;
}

export function useConversationSync({ messages, upsertConversation }: ConversationSyncDeps): void {
  const lastSyncedResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    const latest = findLatestResponse(messages);
    if (!latest) return;
    if (lastSyncedResponseIdRef.current === latest.responseId) return;
    upsertConversation(latest.sessionId, latest.firstQuery);
    lastSyncedResponseIdRef.current = latest.responseId;
  }, [messages, upsertConversation]);
}
