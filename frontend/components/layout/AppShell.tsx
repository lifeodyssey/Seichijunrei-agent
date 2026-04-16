"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversationHistory } from "../../hooks/useConversationHistory";
import { useSession } from "../../hooks/useSession";
import { createMessageId, useChat } from "../../hooks/useChat";
import { usePointSelection } from "../../hooks/usePointSelection";
import { useLocale } from "../../lib/i18n-context";
import {
  buildSelectedRouteActionText,
  fetchConversationMessages,
  hydrateResponseData,
  sendSelectedRoute,
} from "../../lib/api";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { PointSelectionContext } from "../../contexts/PointSelectionContext";
import { isVisualResponse } from "../generative/registry";
import { isRouteData, type RuntimeResponse } from "../../lib/types";
import IconSidebar from "./IconSidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "../chat/MessageList";
import ChatInput from "../chat/ChatInput";
import ResultSheet from "./ResultSheet";
import ConversationDrawer from "./ConversationDrawer";
import ResultPanel from "./ResultPanel";

export default function AppShell() {
  const locale = useLocale();
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const { sessionId, setSessionId, clearSession } = useSession();
  const {
    messages,
    send,
    sending,
    clear: clearChat,
    appendMessages,
    replaceMessage,
    removeMessage,
  } = useChat(sessionId, setSessionId, locale);
  const {
    selectedIds,
    toggle,
    clear: clearSelectedPoints,
  } = usePointSelection();
  const { upsert: upsertConversation } = useConversationHistory();
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [routeSending, setRouteSending] = useState(false);
  const lastSyncedResponseIdRef = useRef<string | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const isSending = sending || routeSending;

  // Hydrate messages on mount when a stored session exists
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    fetchConversationMessages(sessionId)
      .then((msgs) => {
        if (!active) return;
        if (msgs.length === 0) {
          // No messages stored for this session — start fresh
          clearSession();
          return;
        }
        const hydrated = msgs.map((m, i) => ({
          id: `hydrated-${i}-${Date.now()}`,
          role: m.role,
          text: m.content,
          response: hydrateResponseData(m.data) as RuntimeResponse | undefined,
          timestamp: new Date(m.timestamp).getTime(),
        }));
        appendMessages(...hydrated);
      })
      .catch((err) => {
        console.error("Session hydration failed:", err);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latestConversationResponse = useMemo(
    () => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        const responseSessionId = message.response?.session_id;
        if (!responseSessionId) continue;

        const firstQuery =
          index > 0 && messages[index - 1]?.role === "user"
            ? messages[index - 1].text
            : "";

        return {
          firstQuery,
          responseId: message.id,
          sessionId: responseSessionId,
        };
      }

      return null;
    },
    [messages],
  );

  useEffect(() => {
    if (!latestConversationResponse) return;
    if (lastSyncedResponseIdRef.current === latestConversationResponse.responseId) {
      return;
    }

    upsertConversation(
      latestConversationResponse.sessionId,
      latestConversationResponse.firstQuery,
    );
    lastSyncedResponseIdRef.current = latestConversationResponse.responseId;
  }, [latestConversationResponse, upsertConversation]);

  const activeMessage = useMemo(
    () =>
      activeMessageId
        ? (messages.find(
            (m) => m.id === activeMessageId && m.response && isVisualResponse(m.response),
          ) ?? null)
        : null,
    [activeMessageId, messages],
  );

  const activeResponse = activeMessage?.response ?? null;

  const defaultOrigin = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const routeHistory = messages[index]?.response?.route_history ?? [];
      const originStation = routeHistory.find((entry) => entry.origin_station)?.origin_station;
      if (originStation) {
        return originStation;
      }
    }
    return "";
  }, [messages]);

  // Auto-open result panel when a visual response arrives
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (
      last.role === "assistant" &&
      !last.loading &&
      last.response &&
      isVisualResponse(last.response)
    ) {
      setActiveMessageId(last.id);
      if (isMobile) {
        setDrawerOpen(true);
      }
    }
  }, [messages, isMobile]);

  const handleNewChat = useCallback(() => {
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
    setRouteSending(false);
    clearChat();
    clearSelectedPoints();
    clearSession();
    lastSyncedResponseIdRef.current = null;
    setActiveMessageId(null);
    setDrawerOpen(false);
  }, [clearChat, clearSelectedPoints, clearSession]);

  const handleActivate = useCallback((messageId: string) => {
    setActiveMessageId((current) => {
      const newId = current === messageId ? null : messageId;
      if (newId && isMobile) {
        setDrawerOpen(true);
      } else if (!newId) {
        setDrawerOpen(false);
      }
      return newId;
    });
  }, [isMobile]);

  const handleSend = useCallback(
    (text: string) => {
      clearSelectedPoints();
      setActiveMessageId(null);
      setDrawerOpen(false);
      send(text);
    },
    [clearSelectedPoints, send],
  );

  const handleRouteSelected = useCallback(
    async (origin: string) => {
      if (selectedIds.size === 0 || isSending) return;

      const ids = Array.from(selectedIds);
      const actionText = buildSelectedRouteActionText(ids.length, origin, locale);
      const userMessage = {
        id: createMessageId(),
        role: "user" as const,
        text: actionText,
        timestamp: Date.now(),
      };
      const placeholderId = createMessageId();
      const placeholder = {
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
        const response = await sendSelectedRoute(
          ids,
          origin,
          sessionId,
          locale,
          controller.signal,
        );

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

        const errorText =
          error instanceof Error ? error.message : "Unknown error";
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
    ],
  );

  const handleOpenDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  // Determine whether the result panel should show route or search data
  const isRouteResult = activeResponse?.data ? isRouteData(activeResponse.data) : false;

  return (
    <PointSelectionContext.Provider value={{ selectedIds, toggle, clear: clearSelectedPoints }}>
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">

        {/* Icon sidebar — 56px, hidden on mobile (<1024px) */}
        <div className={isMobile ? "hidden" : undefined}>
          <IconSidebar
            onNewChat={handleNewChat}
            onSectionClick={(section) => {
              // Section navigation is handled via the icon rail
              if (section === "search") handleNewChat();
              // TODO: wire history section click in Wave 2 (ConversationDrawer integration)
            }}
          />
        </div>

        {/* Chat panel — 360px on desktop, full-width on mobile */}
        <div
          data-testid="chat-panel"
          className={[
            "flex min-h-0 flex-col bg-[var(--color-bg)]",
            isMobile
              ? "flex-1"
              : "w-[360px] min-w-[360px] shrink-0 border-r border-[var(--color-border)]",
          ].join(" ")}
        >
          <ChatHeader
            onNewChat={isMobile ? handleNewChat : undefined}
            onMenuToggle={undefined}
          />
          <MessageList
            messages={messages}
            onActivate={handleActivate}
            activeMessageId={activeMessageId}
            onOpenDrawer={isMobile ? handleOpenDrawer : undefined}
            onSuggest={handleSend}
          />
          <ChatInput
            onSend={handleSend}
            disabled={isSending}
            showQuickActions={isMobile && messages.length === 0}
          />
        </div>

        {/* Result panel — flex-1, desktop only */}
        {!isMobile && (
          <div
            data-testid="result-panel"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <ResultPanel
              activeResponse={activeResponse}
              onSuggest={handleSend}
              onRouteSelected={handleRouteSelected}
              defaultOrigin={defaultOrigin}
              loading={isSending && (isRouteResult || !activeResponse)}
            />
          </div>
        )}

        {/* Mobile: vaul bottom sheet for results */}
        {isMobile && (
          <ResultSheet
            response={activeResponse}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSuggest={handleSend}
            onRouteSelected={handleRouteSelected}
            defaultOrigin={defaultOrigin}
            loading={isSending}
          />
        )}
      </div>
    </PointSelectionContext.Provider>
  );
}
