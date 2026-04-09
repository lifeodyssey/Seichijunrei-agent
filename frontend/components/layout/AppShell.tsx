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
  fetchRouteHistory,
  sendSelectedRoute,
} from "../../lib/api";
import type { RouteHistoryEntry } from "../../lib/api";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { PointSelectionContext } from "../../contexts/PointSelectionContext";
import { isVisualResponse } from "../generative/registry";
import { isRouteData, isSearchData, type RuntimeResponse } from "../../lib/types";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "../chat/MessageList";
import ChatInput from "../chat/ChatInput";
import ResultDrawer from "./ResultDrawer";
import { SlideOverPanel } from "./SlideOverPanel";
import { FullscreenOverlay } from "./FullscreenOverlay";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";

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
  const [routes, setRoutes] = useState<RouteHistoryEntry[]>([]);
  const [routeSending, setRouteSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [slideOverOpen, setSlideOverOpen] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const lastSyncedResponseIdRef = useRef<string | null>(null);
  const routeAbortRef = useRef<AbortController | null>(null);
  const isSending = sending || routeSending;

  useEffect(() => {
    fetchRouteHistory().then(setRoutes).catch(() => {});
  }, []);

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
          response: m.data ? (m.data as unknown as RuntimeResponse) : undefined,
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

  // Click-to-open only: no auto-open for visual responses (Task 12)
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

  // Determine overlay type from active response
  const openOverlayForResponse = useCallback((response: RuntimeResponse | null) => {
    if (!response) return;
    if (isRouteData(response.data)) {
      setFullscreenOpen(true);
      setSlideOverOpen(false);
    } else if (isSearchData(response.data)) {
      setSlideOverOpen(true);
      setFullscreenOpen(false);
    } else {
      setSlideOverOpen(true);
      setFullscreenOpen(false);
    }
  }, []);

  const handleConversationSelect = useCallback(
    async (selectedSessionId: string) => {
      if (selectedSessionId === sessionId) return;
      routeAbortRef.current?.abort();
      routeAbortRef.current = null;
      setRouteSending(false);
      clearChat();
      clearSelectedPoints();
      setActiveMessageId(null);
      setDrawerOpen(false);
      setSlideOverOpen(false);
      setFullscreenOpen(false);
      setSessionId(selectedSessionId);
      lastSyncedResponseIdRef.current = null;

      try {
        const msgs = await fetchConversationMessages(selectedSessionId);
        const hydrated = msgs.map((m, i) => ({
          id: `hydrated-${i}-${Date.now()}`,
          role: m.role,
          text: m.content,
          response: m.data ? (m.data as unknown as RuntimeResponse) : undefined,
          timestamp: new Date(m.timestamp).getTime(),
        }));
        if (hydrated.length > 0) {
          appendMessages(...hydrated);
        }
      } catch {
        // Best-effort hydration; silent on failure
      }
    },
    [appendMessages, clearChat, clearSelectedPoints, sessionId, setSessionId],
  );

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
    setSlideOverOpen(false);
    setFullscreenOpen(false);
  }, [clearChat, clearSelectedPoints, clearSession]);

  const handleActivate = useCallback((messageId: string) => {
    setActiveMessageId((current) => {
      const newId = current === messageId ? null : messageId;
      if (newId) {
        // Find the message to determine which overlay to open
        const msg = messages.find((m) => m.id === newId);
        if (msg?.response) {
          if (isMobile) {
            setDrawerOpen(true);
          } else {
            openOverlayForResponse(msg.response);
          }
        }
      } else {
        setSlideOverOpen(false);
        setFullscreenOpen(false);
        setDrawerOpen(false);
      }
      return newId;
    });
  }, [isMobile, messages, openOverlayForResponse]);

  const handleSend = useCallback(
    (text: string) => {
      clearSelectedPoints();
      setActiveMessageId(null);
      setDrawerOpen(false);
      setSlideOverOpen(false);
      setFullscreenOpen(false);
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
      setSlideOverOpen(false);
      setFullscreenOpen(false);
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

  const handleCloseSlideOver = useCallback(() => {
    setSlideOverOpen(false);
    setActiveMessageId(null);
  }, []);

  const handleCloseFullscreen = useCallback(() => {
    setFullscreenOpen(false);
    setActiveMessageId(null);
  }, []);

  const handleOpenDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  return (
    <PointSelectionContext.Provider value={{ selectedIds, toggle, clear: clearSelectedPoints }}>
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
        {/* Sidebar — collapsible on desktop, overlay on mobile */}
        {!isMobile && sidebarOpen && (
          <Sidebar
            conversations={conversations}
            activeSessionId={sessionId}
            onNewChat={handleNewChat}
            onRenameConversation={renameConversation}
            onSelectConversation={handleConversationSelect}
            routes={routes}
            onCollapse={() => setSidebarOpen(false)}
          />
        )}
        {isMobile && sidebarOpen && (
          <>
            {/* Dark backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/30"
              onClick={() => setSidebarOpen(false)}
              style={{ animation: "fade-in 200ms ease both" }}
            />
            {/* Sidebar overlay */}
            <div
              className="fixed inset-y-0 left-0 z-50 w-[280px] bg-[var(--color-bg)] shadow-xl"
              style={{ animation: "slide-in-left 250ms var(--ease-out-quint) both" }}
            >
              <Sidebar
                conversations={conversations}
                activeSessionId={sessionId}
                onNewChat={() => { handleNewChat(); setSidebarOpen(false); }}
                onRenameConversation={renameConversation}
                onSelectConversation={(id) => { handleConversationSelect(id); setSidebarOpen(false); }}
                routes={routes}
                onCollapse={() => setSidebarOpen(false)}
                variant="mobile"
              />
            </div>
          </>
        )}

        {/* Main chat area — takes full width */}
        <main className="flex min-h-0 flex-1 flex-col bg-[var(--color-bg)]">
          <ChatHeader
            onNewChat={isMobile ? handleNewChat : undefined}
            onMenuToggle={!sidebarOpen || isMobile ? () => setSidebarOpen((s) => !s) : undefined}
          />
          <MessageList
            messages={messages}
            onActivate={handleActivate}
            activeMessageId={activeMessageId}
            onOpenDrawer={isMobile ? handleOpenDrawer : undefined}
            onSuggest={handleSend}
          />
          <ChatInput onSend={handleSend} disabled={isSending} showQuickActions={isMobile && messages.length === 0} />
        </main>

        {/* Mobile: vaul bottom sheet */}
        {isMobile && (
          <ResultDrawer
            response={activeResponse}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSuggest={handleSend}
            onRouteSelected={handleRouteSelected}
            defaultOrigin={defaultOrigin}
            loading={isSending}
          />
        )}

        {/* Desktop: Slide-over for search results */}
        {!isMobile && (
          <SlideOverPanel open={slideOverOpen} onClose={handleCloseSlideOver} loading={isSending && slideOverOpen}>
            {activeResponse && (
              <GenerativeUIRenderer response={activeResponse} onSuggest={handleSend} />
            )}
          </SlideOverPanel>
        )}

        {/* Desktop: Fullscreen for route results */}
        {!isMobile && (
          <FullscreenOverlay open={fullscreenOpen} onClose={handleCloseFullscreen}>
            {activeResponse && (
              <div className="h-full">
                <GenerativeUIRenderer response={activeResponse} onSuggest={handleSend} />
              </div>
            )}
          </FullscreenOverlay>
        )}
      </div>
    </PointSelectionContext.Provider>
  );
}
