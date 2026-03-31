"use client";

import { useCallback, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { useLocale } from "../../lib/i18n-context";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "../chat/MessageList";
import ChatInput from "../chat/ChatInput";
import ResultPanel from "./ResultPanel";
import ResultDrawer from "./ResultDrawer";
import type { RouteHistoryRecord } from "../../lib/types";

export default function AppShell() {
  const locale = useLocale();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { sessionId, setSessionId, clearSession } = useSession();
  const { messages, send, sending, clear } = useChat(sessionId, setSessionId, locale);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Extract route history from the latest response that has one
  const routeHistory: RouteHistoryRecord[] =
    [...messages]
      .reverse()
      .find((m) => m.response?.route_history?.length)
      ?.response?.route_history ?? [];

  const latestResponseMessage = useMemo(
    () => [...messages].reverse().find((m) => m.response) ?? null,
    [messages],
  );

  const activeMessage = activeMessageId
    ? messages.find((message) => message.id === activeMessageId) ?? null
    : latestResponseMessage;

  const activeResponse = activeMessage?.response ?? null;
  const activeResultMessageId = activeMessage?.id ?? null;

  const handleNewChat = useCallback(() => {
    clear();
    clearSession();
    setActiveMessageId(null);
  }, [clear, clearSession]);

  const handleActivate = useCallback((messageId: string) => {
    setActiveMessageId((current) => (current === messageId ? null : messageId));
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      setActiveMessageId(null);
      send(text);
    },
    [send],
  );

  const handleSuggest = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend],
  );

  const handleOpenDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {!isMobile && <Sidebar routeHistory={routeHistory} onNewChat={handleNewChat} />}

      <main className={`flex min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)] ${isMobile ? "flex-1" : "w-[360px] shrink-0"}`}>
        <ChatHeader />
        <MessageList
          messages={messages}
          onActivate={handleActivate}
          activeMessageId={activeResultMessageId}
          onOpenDrawer={isMobile ? handleOpenDrawer : undefined}
        />
        <ChatInput onSend={handleSend} disabled={sending} prefill="" />
      </main>

      {isMobile ? (
        <ResultDrawer
          response={activeResponse}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSuggest={handleSuggest}
        />
      ) : (
        <ResultPanel activeResponse={activeResponse} onSuggest={handleSuggest} />
      )}
    </div>
  );
}
