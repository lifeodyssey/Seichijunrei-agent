"use client";

import { useEffect } from "react";
import { fetchConversationMessages, hydrateResponseData } from "../lib/api";
import type { ChatMessage, RuntimeResponse } from "../lib/types";

interface SessionHydrationDeps {
  sessionId: string | null;
  clearSession: () => void;
  appendMessages: (...msgs: ChatMessage[]) => void;
}

export function useSessionHydration({
  sessionId,
  clearSession,
  appendMessages,
}: SessionHydrationDeps): void {
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    fetchConversationMessages(sessionId)
      .then((msgs) => {
        if (!active) return;
        if (msgs.length === 0) { clearSession(); return; }
        const hydrated = msgs.map((m, i) => ({
          id: `hydrated-${i}-${Date.now()}`,
          role: m.role,
          text: m.content,
          response: hydrateResponseData(m.data) as RuntimeResponse | undefined,
          timestamp: new Date(m.timestamp).getTime(),
        }));
        appendMessages(...hydrated);
      })
      .catch((err) => { console.error("Session hydration failed:", err); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
