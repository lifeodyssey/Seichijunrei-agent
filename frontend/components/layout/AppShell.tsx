"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversationHistory } from "../../hooks/useConversationHistory";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { useLocale } from "../../lib/i18n-context";
import { useMediaQuery } from "../../hooks/useMediaQuery";
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
  const { messages, send, sending, clear } = useChat(sessionId, setSessionId, locale);
  const { conversations, upsert: upsertConversation, rename: renameConversation } =
    useConversationHistory();
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(360);
  const chatWidthRef = useRef(chatWidth);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const lastSyncedResponseIdRef = useRef<string | null>(null);

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
    selectedVisualMessage ?? (sending ? null : latestVisualResponseMessage);

  const activeResponse = activeMessage?.response ?? null;
  const activeResultMessageId = activeMessage?.id ?? null;

  const handleNewChat = useCallback(() => {
    clear();
    clearSession();
    lastSyncedResponseIdRef.current = null;
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
          !isMobile && hasVisualResponse
            ? {
                width: chatWidth,
                transition: "width var(--duration-base) var(--ease-out-expo)",
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
        <ChatInput onSend={handleSend} disabled={sending} />
      </main>

      {isMobile ? (
        <ResultDrawer
          response={activeResponse}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSuggest={handleSend}
          loading={sending}
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
          <ResultPanel activeResponse={activeResponse} onSuggest={handleSend} loading={sending} />
        </>
      )}
    </div>
  );
}
