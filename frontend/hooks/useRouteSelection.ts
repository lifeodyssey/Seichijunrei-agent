"use client";

import { useCallback, useRef, useState } from "react";
import { buildSelectedRouteActionText, sendSelectedRoute } from "../lib/api";
import { createMessageId } from "./useChat";
import type { ChatMessage, RuntimeResponse } from "../lib/types";
import type { Locale } from "../lib/i18n";

interface RouteSelectionDeps {
  selectedIds: Set<string>;
  sessionId: string | null;
  locale: Locale;
  isSending: boolean;
  setSessionId: (id: string) => void;
  appendMessages: (...msgs: ChatMessage[]) => void;
  replaceMessage: (id: string, updater: (m: ChatMessage) => ChatMessage) => void;
  removeMessage: (id: string) => void;
  clearSelectedPoints: () => void;
  setActiveMessageId: (id: string | null) => void;
  setDrawerOpen: (open: boolean) => void;
}

interface RouteSelectionResult {
  routeSending: boolean;
  handleRouteSelected: (origin: string) => Promise<void>;
  abortRoute: () => void;
}

export function useRouteSelection({
  selectedIds,
  sessionId,
  locale,
  isSending,
  setSessionId,
  appendMessages,
  replaceMessage,
  removeMessage,
  clearSelectedPoints,
  setActiveMessageId,
  setDrawerOpen,
}: RouteSelectionDeps): RouteSelectionResult {
  const [routeSending, setRouteSending] = useState(false);
  const routeAbortRef = useRef<AbortController | null>(null);

  const abortRoute = useCallback(() => {
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
    setRouteSending(false);
  }, []);

  const handleRouteSelected = useCallback(
    async (origin: string) => {
      if (selectedIds.size === 0 || isSending) return;

      const ids = Array.from(selectedIds);
      const actionText = buildSelectedRouteActionText(ids.length, origin, locale);
      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: "user" as const,
        text: actionText,
        timestamp: Date.now(),
      };
      const placeholderId = createMessageId();
      const placeholder: ChatMessage = {
        id: placeholderId,
        role: "assistant" as const,
        text: "",
        loading: true,
        steps: [],
        timestamp: Date.now(),
      };

      routeAbortRef.current?.abort();
      const controller = new AbortController();
      routeAbortRef.current = controller;

      clearSelectedPoints();
      setActiveMessageId(null);
      setDrawerOpen(false);
      appendMessages(userMessage, placeholder);
      setRouteSending(true);

      try {
        const response = (await sendSelectedRoute(
          ids,
          origin,
          sessionId,
          locale,
          controller.signal,
        )) as RuntimeResponse;

        if (controller.signal.aborted) {
          removeMessage(placeholderId);
          return;
        }

        if (response.session_id) {
          setSessionId(response.session_id);
        }

        replaceMessage(placeholderId, (message) => ({
          ...message,
          text: response.message,
          response,
          loading: false,
        }));
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          removeMessage(placeholderId);
          return;
        }
        const errorText = error instanceof Error ? error.message : "Unknown error";
        replaceMessage(placeholderId, (message) => ({
          ...message,
          text: `Error: ${errorText}`,
          loading: false,
        }));
      } finally {
        if (routeAbortRef.current === controller) {
          routeAbortRef.current = null;
        }
        setRouteSending(false);
      }
    },
    [
      appendMessages,
      clearSelectedPoints,
      isSending,
      locale,
      removeMessage,
      replaceMessage,
      selectedIds,
      sessionId,
      setSessionId,
      setActiveMessageId,
      setDrawerOpen,
    ],
  );

  return { routeSending, handleRouteSelected, abortRoute };
}
