"use client";

import { useState, useCallback, useRef } from "react";
import type { ChatMessage, RuntimeRequest, RuntimeResponse } from "../lib/types";
import { sendMessage } from "../lib/api";

let msgCounter = 0;
function nextId() {
  return `msg-${Date.now()}-${++msgCounter}`;
}

export function useChat(
  sessionId: string | null,
  onSessionId: (id: string) => void,
  locale?: RuntimeRequest["locale"],
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;

      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        text: text.trim(),
        timestamp: Date.now(),
      };

      const placeholderId = nextId();
      const placeholder: ChatMessage = {
        id: placeholderId,
        role: "assistant",
        text: "",
        loading: true,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, placeholder]);
      setSending(true);

      try {
        abortRef.current = new AbortController();
        const response: RuntimeResponse = await sendMessage(
          text.trim(),
          sessionId,
          locale,
          abortRef.current.signal,
        );

        if (response.session_id) {
          onSessionId(response.session_id);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? { ...m, text: response.message, response, loading: false }
              : m,
          ),
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
          return;
        }
        const errorText =
          err instanceof Error ? err.message : "Unknown error";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? { ...m, text: `Error: ${errorText}`, loading: false }
              : m,
          ),
        );
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    [sessionId, sending, onSessionId, locale],
  );

  const clear = useCallback(() => setMessages([]), []);

  return { messages, send, sending, clear };
}
