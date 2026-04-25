"use client";

import { useState, useCallback, useRef } from "react";
import type { ChatMessage, ErrorCode, RuntimeRequest, RuntimeResponse } from "../lib/types";
import { sendMessageStream } from "../lib/api";

let msgCounter = 0;
export function createMessageId() {
  return `msg-${Date.now()}-${++msgCounter}`;
}

type MessageUpdate = ChatMessage | ((message: ChatMessage) => ChatMessage);

export function useChat(
  sessionId: string | null,
  onSessionId: (id: string) => void,
  locale?: RuntimeRequest["locale"],
  onTitleUpdate?: (sessionId: string, title: string) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const appendMessages = useCallback((...nextMessages: ChatMessage[]) => {
    if (nextMessages.length === 0) return;
    setMessages((prev) => [...prev, ...nextMessages]);
  }, []);

  const replaceMessage = useCallback((id: string, update: MessageUpdate) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== id) return message;
        return typeof update === "function" ? update(message) : update;
      }),
    );
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((message) => message.id !== id));
  }, []);

  const send = useCallback(
    async (text: string, coords?: { lat: number; lng: number } | null) => {
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

      // Abort any previous in-flight request (safety net — normally guarded by `sending`)
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response: RuntimeResponse = await sendMessageStream(
          text.trim(),
          sessionId,
          locale,
          (tool, status, thought, observation) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? {
                      ...m,
                      steps: [
                        ...((m.steps ?? []).filter(
                          (step) => step.tool !== tool || status === "running",
                        )),
                        { tool, status, thought: thought || "", observation: observation || "" },
                      ],
                    }
                  : m,
              ),
            );
          },
          controller.signal,
          coords,
        );

        // Guard: fetch resolved but session was cleared (abort fired after completion)
        if (controller.signal.aborted) {
          setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
          return;
        }

        if (response.session_id) {
          onSessionId(response.session_id);
        }

        // TODO: re-enable when conversation history title generation is wired back
        // const effectiveSessionId = response.session_id ?? sessionId;
        // if (response.generated_title && effectiveSessionId) {
        //   onTitleUpdate?.(effectiveSessionId, response.generated_title);
        // }

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
        const errorCode = classifyError(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? { ...m, text: errorText, loading: false, errorCode }
              : m,
          ),
        );
      } finally {
        setSending(false);
        // Only clear ref if we still own it (clear() may have nulled it)
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [sessionId, sending, onSessionId, locale, onTitleUpdate],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
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

function classifyError(err: unknown): ErrorCode {
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("stream") || msg.includes("network") || msg.includes("fetch")) {
    return "stream_error";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("rate") || msg.includes("limit") || msg.includes("429")) {
    return "rate_limit";
  }
  return "generic";
}
