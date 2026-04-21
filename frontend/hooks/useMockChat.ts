"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ChatMessage, RuntimeResponse } from "../lib/types";
import {
  MOCK_SEARCH_RESPONSE,
  MOCK_ROUTE_RESPONSE,
  MOCK_CLARIFY_RESPONSE,
  MOCK_NEARBY_RESPONSE,
  MOCK_GREET_RESPONSE,
} from "../lib/mock-data";
import { useChat, createMessageId } from "./useChat";

// ── Query routing ─────────────────────────────────────────────────────────

type MockRoute = {
  patterns: RegExp[];
  response: RuntimeResponse;
  delayMs: number;
};

const MOCK_ROUTES: MockRoute[] = [
  {
    patterns: [/涼宮/i, /haruhi/i],
    response: MOCK_CLARIFY_RESPONSE,
    delayMs: 1000,
  },
  {
    patterns: [/附近/i, /nearby/i, /宇治/i],
    response: MOCK_NEARBY_RESPONSE,
    delayMs: 1000,
  },
  {
    patterns: [/路线/i, /route/i, /plan/i],
    response: MOCK_ROUTE_RESPONSE,
    delayMs: 2000,
  },
  {
    patterns: [/ユーフォ/i, /吹响/i, /euphonium/i],
    response: MOCK_SEARCH_RESPONSE,
    delayMs: 1500,
  },
];

function matchRoute(text: string): { response: RuntimeResponse; delayMs: number } {
  for (const route of MOCK_ROUTES) {
    if (route.patterns.some((p) => p.test(text))) {
      return { response: route.response, delayMs: route.delayMs };
    }
  }
  return { response: MOCK_SEARCH_RESPONSE, delayMs: 1500 };
}

// ── useMockChat ───────────────────────────────────────────────────────────

export function useMockChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the greeting on mount
  useEffect(() => {
    const greetMsg: ChatMessage = {
      id: createMessageId(),
      role: "assistant",
      text: MOCK_GREET_RESPONSE.message,
      response: MOCK_GREET_RESPONSE,
      loading: false,
      timestamp: Date.now(),
    };
    setMessages([greetMsg]);
  }, []);

  const appendMessages = useCallback((...nextMessages: ChatMessage[]) => {
    if (nextMessages.length === 0) return;
    setMessages((prev) => [...prev, ...nextMessages]);
  }, []);

  const replaceMessage = useCallback(
    (id: string, update: ChatMessage | ((m: ChatMessage) => ChatMessage)) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          return typeof update === "function" ? update(m) : update;
        }),
      );
    },
    [],
  );

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const send = useCallback(
    async (text: string, _coords?: { lat: number; lng: number } | null) => {
      if (!text.trim() || sending) return;

      const userMsg: ChatMessage = {
        id: createMessageId(),
        role: "user",
        text: text.trim(),
        timestamp: Date.now(),
      };

      const placeholderId = createMessageId();
      const placeholder: ChatMessage = {
        id: placeholderId,
        role: "assistant",
        text: "",
        loading: true,
        steps: [],
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, placeholder]);
      setSending(true);

      const { response, delayMs } = matchRoute(text);

      await new Promise<void>((resolve) => {
        timerRef.current = setTimeout(resolve, delayMs);
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? { ...m, text: response.message, response, loading: false }
            : m,
        ),
      );
      setSending(false);
    },
    [sending],
  );

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMessages([]);
  }, []);

  return {
    messages,
    send,
    sending,
    clear,
    appendMessages,
    replaceMessage,
    removeMessage,
  };
}

// ── Wrapper: mock or real based on env var ─────────────────────────────────

export function useChatWithMock(
  sessionId: string | null,
  onSessionId: (id: string) => void,
  locale?: "ja" | "zh" | "en",
) {
  const mock = useMockChat();
  const real = useChat(sessionId, onSessionId, locale);
  return process.env.NEXT_PUBLIC_MOCK_MODE === "true" ? mock : real;
}
