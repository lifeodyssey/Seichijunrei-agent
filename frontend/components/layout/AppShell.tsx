"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConversationHistory } from "../../hooks/useConversationHistory";
import { useSession } from "../../hooks/useSession";
import { useChat } from "../../hooks/useChat";
import { usePointSelection } from "../../hooks/usePointSelection";
import { useLocale, useDict } from "../../lib/i18n-context";
import { useLayoutMode } from "../../hooks/useLayoutMode";
import { useRouteSelection } from "../../hooks/useRouteSelection";
import { useSessionHydration } from "../../hooks/useSessionHydration";
import { useConversationSync } from "../../hooks/useConversationSync";
import { PointSelectionContext } from "../../contexts/PointSelectionContext";
import { SuggestContext } from "../../contexts/SuggestContext";
import { isVisualResponse } from "../generative/registry";
import { isRouteData } from "../../lib/types";
import { cn } from "../../lib/utils";
import IconSidebar from "./IconSidebar";
import ChatPanel from "../chat/ChatPanel";
import ResultSheet from "./ResultSheet";
import ConversationDrawer from "./ConversationDrawer";
import ResultPanel from "./ResultPanel";
import ChatPopup from "../chat/ChatPopup";

// ---------------------------------------------------------------------------
// Floating toggle — appears in full-result mode to bring chat back
// ---------------------------------------------------------------------------

function FloatingChatToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show chat"
      className="fixed bottom-6 left-20 z-30 flex h-10 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-4 text-sm font-medium text-[var(--color-fg)] shadow-lg transition-transform duration-150 hover:scale-105 active:scale-95"
      style={{ animation: "pop-in 0.25s var(--ease-out-expo)" }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      Chat
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sidebar overlay — used on tablet / mobile when sidebar is toggled open
// ---------------------------------------------------------------------------

function SidebarOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
        style={{ animation: "fade-in 0.15s ease-out" }}
      />
      <div
        className="fixed bottom-0 left-0 top-0 z-50"
        style={{ animation: "slide-in-left 0.2s var(--ease-out-expo)" }}
      >
        {children}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// AppShell — adaptive layout shell
// ---------------------------------------------------------------------------

export default function AppShell() {
  const locale = useLocale();
  const dict = useDict();
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatPopupOpen, setChatPopupOpen] = useState(false);

  useSessionHydration({ sessionId, clearSession, appendMessages });
  useConversationSync({ messages, upsertConversation });

  const activeMessage = useMemo(
    () => activeMessageId
      ? (messages.find((m) => m.id === activeMessageId && m.response && isVisualResponse(m.response)) ?? null)
      : null,
    [activeMessageId, messages],
  );

  const activeResponse = activeMessage?.response ?? null;

  // ── Adaptive layout ──────────���──────────────────────────────────────────
  const layout = useLayoutMode(activeResponse !== null, activeMessageId);
  const { mode, isMobile, isTablet } = layout;
  // Treat SSR/test default (all media queries false) as desktop.
  const showPermanentSidebar = !isMobile && !isTablet;
  const showOverlaySidebar = isMobile || isTablet;

  const defaultOrigin = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const routeHistory = messages[index]?.response?.route_history ?? [];
      const origin = routeHistory.find((entry) => entry.origin_station)?.origin_station;
      if (origin) return origin;
    }
    return "";
  }, [messages]);

  // Auto-activate latest visual response
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
    setSidebarOpen(false);
  }, [abortRoute, clearChat, clearSelectedPoints, clearSession]);

  const handleSidebarSection = useCallback(
    (section: "history" | "favorites" | "settings") => {
      setSidebarOpen(false);
      if (section === "history") setConversationDrawerOpen(true);
      // favorites and settings: TODO — placeholder for now
    },
    [],
  );

  const isSending = sending || routeSending;
  const isRouteResult = activeResponse?.data ? isRouteData(activeResponse.data) : false;

  return (
    <SuggestContext.Provider value={{ onSuggest: handleSend }}>
      <PointSelectionContext.Provider value={{ selectedIds, toggle, clear: clearSelectedPoints }}>
        <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">

          {/* ── Desktop sidebar: always visible ────────────────────────── */}
          {showPermanentSidebar && (
            <IconSidebar
              onNewChat={handleNewChat}
              onSectionClick={handleSidebarSection}
            />
          )}

          {/* ── Tablet/mobile sidebar: overlay ─────���───────────────────── */}
          {showOverlaySidebar && sidebarOpen && (
            <SidebarOverlay onClose={() => setSidebarOpen(false)}>
              <IconSidebar
                onNewChat={() => { handleNewChat(); setSidebarOpen(false); }}
                onSectionClick={handleSidebarSection}
              />
            </SidebarOverlay>
          )}

          {/* ── Content area: adaptive layout ──────────────────────────── */}
          <div className="flex min-w-0 flex-1 overflow-hidden">

            {/* Chat panel — visible in chat + split modes */}
            {mode !== "full-result" && (
              <div
                data-testid="chat-panel"
                className={cn(
                  "flex min-h-0 flex-col",
                  isMobile && "flex-1",
                  !isMobile && mode === "chat" && "flex-1",
                  !isMobile && mode === "split" && "w-[340px] shrink-0",
                )}
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
                  layoutMode={isMobile ? "chat" : mode}
                  onMenuOpen={showOverlaySidebar ? () => setSidebarOpen(true) : undefined}
                />
              </div>
            )}

            {/* Result panel — visible in split + full-result modes (desktop/tablet only) */}
            {!isMobile && mode !== "chat" && (
              <div
                data-testid="result-panel"
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                style={{ animation: "panel-slide-in 0.3s var(--ease-out-expo)" }}
              >
                <ResultPanel
                  activeResponse={activeResponse}
                  onRouteSelected={handleRouteSelected}
                  defaultOrigin={defaultOrigin}
                  loading={isSending && (isRouteResult || !activeResponse)}
                  onCollapse={layout.collapseResult}
                  onExpand={layout.expandResult}
                  isFullScreen={mode === "full-result"}
                />
              </div>
            )}
          </div>

          {/* ── Mobile result sheet ─────────────────────────────────────── */}
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

          {/* ── Conversation history drawer ─────────────────────────────── */}
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

          {/* ── Full-result mode: floating chat toggle + popup ──────────── */}
          {mode === "full-result" && !chatPopupOpen && (
            <FloatingChatToggle onClick={() => setChatPopupOpen(true)} />
          )}
          {mode === "full-result" && (
            <ChatPopup
              open={chatPopupOpen}
              onClose={() => setChatPopupOpen(false)}
              messages={messages}
              sending={isSending}
              activeMessageId={activeMessageId}
              dict={dict}
              locale={locale}
              onSend={handleSend}
              onActivate={handleActivate}
            />
          )}
        </div>
      </PointSelectionContext.Provider>
    </SuggestContext.Provider>
  );
}
