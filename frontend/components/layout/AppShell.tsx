"use client";

import { useCallback, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { useLocale } from "../../lib/i18n-context";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "../chat/MessageList";
import ChatInput from "../chat/ChatInput";
import type { RouteHistoryRecord } from "../../lib/types";

export default function AppShell() {
  const locale = useLocale();
  const { sessionId, setSessionId, clearSession } = useSession();
  const { messages, send, sending, clear } = useChat(sessionId, setSessionId, locale);
  const [prefill, setPrefill] = useState("");

  // Extract route history from the latest response that has one
  const routeHistory: RouteHistoryRecord[] =
    [...messages]
      .reverse()
      .find((m) => m.response?.route_history?.length)
      ?.response?.route_history ?? [];

  const handleNewChat = useCallback(() => {
    clear();
    clearSession();
  }, [clear, clearSession]);

  const handleSuggest = useCallback(
    (text: string) => {
      send(text);
    },
    [send],
  );

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      <Sidebar routeHistory={routeHistory} onNewChat={handleNewChat} />

      {/* Main chat area */}
      <main className="flex flex-1 flex-col">
        <ChatHeader />
        <MessageList messages={messages} onSuggest={handleSuggest} />
        <ChatInput
          onSend={send}
          disabled={sending}
          prefill={prefill}
        />
      </main>
    </div>
  );
}
