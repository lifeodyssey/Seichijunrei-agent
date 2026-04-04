"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversationHistory } from "../../hooks/useConversationHistory";
import { useSession } from "../../hooks/useSession";
import { createMessageId, useChat } from "../../hooks/useChat";
import { usePointSelection } from "../../hooks/usePointSelection";
import { useLocale } from "../../lib/i18n-context";
import { buildSelectedRouteActionText, sendSelectedRoute } from "../../lib/api";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { PointSelectionContext } from "../../contexts/PointSelectionContext";
import { isVisualResponse } from "../generative/registry";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "../chat/MessageList";
import ChatInput from "../chat/ChatInput";
import ResultPanel from "./ResultPanel";
import ResultDrawer from "./ResultDrawer";

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
  const { conversations, upsert: upsertConversation, rename: renameConversation } =
    useConversationHistory();
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(360);
  const [routeSending, setRouteSending] = useState(false);
  const chatWidthRef = useRef(chatWidth);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const lastSyncedResponseIdRef = useRef<string | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const isSending = sending || routeSending;

  useEffect(() => { chatWidthRef.current = chatWidth; }, [chatWidth]);

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

  // The most recent message that has a backend response
  const latestResponseMessage = useMemo(
    () => [...messages].reverse().find((m) => m.response) ?? null,
    [messages],
  );

  // Panel opens only when the LATEST response is visual; closes on text replies
  const latestVisualResponseMessage =
    latestResponseMessage?.response && isVisualResponse(latestResponseMessage.response)
      ? latestResponseMessage
      : null;

  // User may have explicitly pinned an older visual message via ◈
  const selectedVisualMessage = useMemo(
    () =>
      activeMessageId
        ? (messages.find(
            (m) => m.id === activeMessageId && m.response && isVisualResponse(m.response),
          ) ?? null)
        : null,
    [activeMessageId, messages],
  );

  const hasVisualResponse = selectedVisualMessage !== null || latestVisualResponseMessage !== null;
  // Suppress stale visual during loading (Bug 2); honour explicit pin otherwise
  const activeMessage =
    selectedVisualMessage ?? (isSending ? null : latestVisualResponseMessage);

  const activeResponse = activeMessage?.response ?? null;
  const activeResultMessageId = activeMessage?.id ?? null;

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
    setActiveMessageId((current) => (current === messageId ? null : messageId));
  }, []);

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

  const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = { startX: e.clientX, startWidth: chatWidthRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handleDividerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const delta = e.clientX - dragState.current.startX;
    setChatWidth(Math.min(520, Math.max(280, dragState.current.startWidth + delta)));
  }, []);

  const handleDividerPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const handleOpenDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  return (
    <PointSelectionContext.Provider value={{ selectedIds, toggle, clear: clearSelectedPoints }}>
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
        {!isMobile && (
          <Sidebar
            conversations={conversations}
            activeSessionId={sessionId}
            onNewChat={handleNewChat}
            onRenameConversation={renameConversation}
          />
        )}

        <main
          className={`flex min-h-0 flex-col bg-[var(--color-bg)] ${
            !isMobile && hasVisualResponse
              ? "shrink-0 border-r border-[var(--color-border)]"
              : "flex-1"
          }`}
          style={
            !isMobile
              ? {
                  flexBasis: hasVisualResponse ? `${chatWidth}px` : "0px",
                  transition: "flex-basis var(--duration-base) var(--ease-out-expo)",
                }
              : undefined
          }
        >
          <ChatHeader onNewChat={isMobile ? handleNewChat : undefined} />
          <MessageList
            messages={messages}
            onActivate={handleActivate}
            activeMessageId={activeResultMessageId}
            onOpenDrawer={isMobile ? handleOpenDrawer : undefined}
            onSuggest={handleSend}
          />
          <ChatInput onSend={handleSend} disabled={isSending} />
        </main>

        {isMobile ? (
          <ResultDrawer
            response={activeResponse}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSuggest={handleSend}
            onRouteSelected={handleRouteSelected}
            defaultOrigin={defaultOrigin}
            loading={isSending}
          />
        ) : hasVisualResponse && (
          <>
            <div
              onPointerDown={handleDividerPointerDown}
              onPointerMove={handleDividerPointerMove}
              onPointerUp={handleDividerPointerUp}
              className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] transition-colors hover:bg-[var(--color-primary)]"
              style={{
                transitionDuration: "var(--duration-fast)",
                animation: "panel-slide-in var(--duration-base) var(--ease-out-expo) both",
              }}
            />
            <ResultPanel
              activeResponse={activeResponse}
              onSuggest={handleSend}
              onRouteSelected={handleRouteSelected}
              defaultOrigin={defaultOrigin}
              loading={isSending}
            />
          </>
        )}
      </div>
    </PointSelectionContext.Provider>
  );
}
