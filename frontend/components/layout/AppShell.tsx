"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const { sessionId, setSessionId, clearSession } = useSession();
  const { messages, send, sending, clear } = useChat(sessionId, setSessionId, locale);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(360);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

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
    setDrawerOpen(false);
  }, [clear, clearSession]);

  const handleActivate = useCallback((messageId: string) => {
    setActiveMessageId((current) => (current === messageId ? null : messageId));
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      setActiveMessageId(null);
      setDrawerOpen(false);
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

  const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = { startX: e.clientX, startWidth: chatWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [chatWidth]);

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
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {!isMobile && <Sidebar routeHistory={routeHistory} onNewChat={handleNewChat} />}

      <main
        className={`flex min-h-0 flex-col bg-[var(--color-bg)] ${
          !isMobile && messages.some((m) => m.response)
            ? "shrink-0 border-r border-[var(--color-border)]"
            : "flex-1"
        }`}
        style={!isMobile && messages.some((m) => m.response) ? { width: chatWidth } : undefined}
      >
        <ChatHeader onNewChat={isMobile ? handleNewChat : undefined} />
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
      ) : messages.some((m) => m.response) && (
        <>
          <div
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
            className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] transition-colors hover:bg-[var(--color-primary)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          />
          <ResultPanel activeResponse={activeResponse} onSuggest={handleSuggest} />
        </>
      )}
    </div>
  );
}
