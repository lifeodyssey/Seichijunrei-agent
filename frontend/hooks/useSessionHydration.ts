"use client";

import { useEffect, useRef } from "react";
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
  // Refs keep the latest callbacks without triggering re-runs of the effect.
  const clearRef = useRef(clearSession);
  const appendRef = useRef(appendMessages);
  useEffect(() => { clearRef.current = clearSession; }, [clearSession]);
  useEffect(() => { appendRef.current = appendMessages; }, [appendMessages]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    fetchConversationMessages(sessionId)
      .then((msgs) => {
        if (!active) return;
        if (msgs.length === 0) { clearRef.current(); return; }
        const hydrated = msgs.map((m, i) => ({
          id: `hydrated-${i}-${Date.now()}`,
          role: m.role,
          text: m.content,
          response: hydrateResponseData(m.data) as RuntimeResponse | undefined,
          timestamp: new Date(m.timestamp).getTime(),
        }));
        appendRef.current(...hydrated);
      })
      .catch((err) => { console.error("Session hydration failed:", err); });
    return () => { active = false; };
  }, [sessionId]);
}
