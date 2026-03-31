"use client";

import { useCallback, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { useLocale } from "../../lib/i18n-context";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "../chat/MessageList";
import ChatInput from "../chat/ChatInput";
import ResultPanel from "./ResultPanel";
import type { RouteHistoryRecord } from "../../lib/types";

export default function AppShell() {
  const locale = useLocale();
  const { sessionId, setSessionId, clearSession } = useSession();
  const { messages, send, sending, clear } = useChat(sessionId, setSessionId, locale);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

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

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      <Sidebar routeHistory={routeHistory} onNewChat={handleNewChat} />

      <main className="flex min-h-0 w-[360px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)]">
        <ChatHeader />
        <MessageList
          messages={messages}
          onActivate={handleActivate}
          activeMessageId={activeResultMessageId}
        />
        <ChatInput onSend={handleSend} disabled={sending} prefill="" />
      </main>

      <ResultPanel activeResponse={activeResponse} onSuggest={handleSuggest} />
    </div>
  );
}
