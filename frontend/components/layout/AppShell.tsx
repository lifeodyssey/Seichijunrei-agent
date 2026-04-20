"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConversationHistory } from "../../hooks/useConversationHistory";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { usePointSelection } from "../../hooks/usePointSelection";
import { useLocale, useDict } from "../../lib/i18n-context";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useRouteSelection } from "../../hooks/useRouteSelection";
import { useSessionHydration } from "../../hooks/useSessionHydration";
import { useConversationSync } from "../../hooks/useConversationSync";
import { PointSelectionContext } from "../../contexts/PointSelectionContext";
import { SuggestContext } from "../../contexts/SuggestContext";
import { isVisualResponse } from "../generative/registry";
import { isRouteData } from "../../lib/types";
import IconSidebar from "./IconSidebar";
import ChatPanel from "../chat/ChatPanel";
import ResultSheet from "./ResultSheet";
import ConversationDrawer from "./ConversationDrawer";
import ResultPanel from "./ResultPanel";

export default function AppShell() {
  const locale = useLocale();
  const dict = useDict();
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
  const { selectedIds, toggle, clear: clearSelectedPoints } = usePointSelection();
  const { conversations, upsert: upsertConversation } = useConversationHistory();
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [conversationDrawerOpen, setConversationDrawerOpen] = useState(false);

  useSessionHydration({ sessionId, clearSession, appendMessages });
  useConversationSync({ messages, upsertConversation });

  const activeMessage = useMemo(
    () => activeMessageId
      ? (messages.find((m) => m.id === activeMessageId && m.response && isVisualResponse(m.response)) ?? null)
      : null,
    [activeMessageId, messages],
  );

  const activeResponse = activeMessage?.response ?? null;

  const defaultOrigin = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const routeHistory = messages[index]?.response?.route_history ?? [];
      const origin = routeHistory.find((entry) => entry.origin_station)?.origin_station;
      if (origin) return origin;
    }
    return "";
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant" || last.loading || !last.response) return;
    if (!isVisualResponse(last.response)) return;
    const id = last.id;
    const mobile = isMobile;
    queueMicrotask(() => {
      setActiveMessageId(id);
      if (mobile) setDrawerOpen(true);
    });
  }, [messages, isMobile]);

  const handleSend = useCallback(
    (text: string, coords?: { lat: number; lng: number } | null) => {
      clearSelectedPoints();
      setActiveMessageId(null);
      setDrawerOpen(false);
      send(text, coords);
    },
    [clearSelectedPoints, send],
  );

  const handleActivate = useCallback((messageId: string) => {
    setActiveMessageId((current) => {
      const newId = current === messageId ? null : messageId;
      if (newId && isMobile) setDrawerOpen(true);
      else if (!newId) setDrawerOpen(false);
      return newId;
    });
  }, [isMobile]);

  const { routeSending, handleRouteSelected, abortRoute } = useRouteSelection({
    selectedIds,
    sessionId,
    locale,
    isSending: sending,
    setSessionId,
    appendMessages,
    replaceMessage,
    removeMessage,
    clearSelectedPoints,
    setActiveMessageId,
    setDrawerOpen,
  });

  const handleNewChat = useCallback(() => {
    abortRoute();
    clearChat();
    clearSelectedPoints();
    clearSession();
    setActiveMessageId(null);
    setDrawerOpen(false);
  }, [abortRoute, clearChat, clearSelectedPoints, clearSession]);

  const isSending = sending || routeSending;
  const isRouteResult = activeResponse?.data ? isRouteData(activeResponse.data) : false;

  return (
    <SuggestContext.Provider value={{ onSuggest: handleSend }}>
      <PointSelectionContext.Provider value={{ selectedIds, toggle, clear: clearSelectedPoints }}>
        <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">

          <div className={isMobile ? "hidden" : "flex"}>
            <IconSidebar
              onNewChat={handleNewChat}
              onSectionClick={(section) => {
                if (section === "search") handleNewChat();
                if (section === "history") setConversationDrawerOpen(true);
              }}
            />
          </div>

          <div
            data-testid="chat-panel"
            className={isMobile ? "flex min-h-0 flex-1 flex-col" : "flex"}
          >
            <ChatPanel
              messages={messages}
              sending={isSending}
              activeMessageId={activeMessageId}
              dict={dict}
              locale={locale}
              onSend={handleSend}
              onActivate={handleActivate}
              onOpenDrawer={isMobile ? () => setDrawerOpen(true) : undefined}
              isMobile={isMobile}
            />
          </div>

          {!isMobile && (
            <div
              data-testid="result-panel"
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            >
              <ResultPanel
                activeResponse={activeResponse}
                onRouteSelected={handleRouteSelected}
                defaultOrigin={defaultOrigin}
                loading={isSending && (isRouteResult || !activeResponse)}
              />
            </div>
          )}

          {isMobile && (
            <ResultSheet
              response={activeResponse}
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              onRouteSelected={handleRouteSelected}
              defaultOrigin={defaultOrigin}
              loading={isSending}
            />
          )}

          <ConversationDrawer
            open={conversationDrawerOpen}
            onClose={() => setConversationDrawerOpen(false)}
            conversations={conversations}
            activeSessionId={sessionId}
            onSelectConversation={(id) => {
              setConversationDrawerOpen(false);
              clearChat();
              clearSelectedPoints();
              setActiveMessageId(null);
              setDrawerOpen(false);
              setSessionId(id);
            }}
            onNewChat={() => {
              setConversationDrawerOpen(false);
              handleNewChat();
            }}
          />
        </div>
      </PointSelectionContext.Provider>
    </SuggestContext.Provider>
  );
}
