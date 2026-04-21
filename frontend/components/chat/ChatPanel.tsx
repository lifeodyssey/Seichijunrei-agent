"use client";

import { useState } from "react";
import type { ChatMessage } from "../../lib/types";
import type { Dict, Locale } from "../../lib/i18n";
import type { LayoutMode } from "../../hooks/useLayoutMode";
import WelcomeScreen from "./WelcomeScreen";
import MessageList from "./MessageList";
import ChatInput from "../chat/ChatInput";
import { cn } from "../../lib/utils";

interface ChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  activeMessageId: string | null;
  dict: Dict;
  locale: Locale;
  onSend: (text: string, coords?: { lat: number; lng: number } | null) => void;
  onActivate: (messageId: string) => void;
  onOpenDrawer?: () => void;
  onSuggest?: (text: string) => void;
  isMobile?: boolean;
  /** Adaptive layout mode — controls width and centering. */
  layoutMode?: LayoutMode;
  /** Opens the sidebar overlay (tablet/mobile). */
  onMenuOpen?: () => void;
}

export default function ChatPanel({
  messages,
  sending,
  activeMessageId,
  dict,
  locale,
  onSend,
  onActivate,
  onOpenDrawer,
  isMobile = false,
  layoutMode = "chat",
  onMenuOpen,
}: ChatPanelProps) {
  const isEmpty = messages.length === 0;
  const [acquiredCoords, setAcquiredCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  function handleLocationAcquired(lat: number, lng: number) {
    setAcquiredCoords({ lat, lng });
  }

  function handleSend(text: string) {
    onSend(text, acquiredCoords);
  }

  // In chat mode (no results), center the content at a comfortable reading width.
  // In split mode, the container is already constrained to 340px by the parent.
  const isCentered = !isMobile && layoutMode === "chat";

  return (
    <div
      className={cn(
        "flex min-h-0 w-full flex-col bg-[var(--color-bg)]",
        !isMobile && layoutMode === "split" && "border-r border-[var(--color-border)]",
      )}
    >
      {/* Tablet/mobile menu bar */}
      {onMenuOpen && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
          <button
            type="button"
            onClick={onMenuOpen}
            aria-label="Menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-muted-fg)] transition-colors hover:bg-[var(--color-muted)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="font-[family-name:var(--app-font-display)] text-sm font-bold text-[var(--color-primary)]">
            聖
          </span>
        </div>
      )}

      {/* Content — centered in chat mode, full-width in split mode */}
      <div className={cn(
        "flex min-h-0 flex-1 flex-col",
        isCentered && "mx-auto w-full max-w-[640px]",
      )}>
        {isEmpty ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <WelcomeScreen onSend={handleSend} dict={dict} locale={locale} />
          </div>
        ) : (
          <MessageList
            messages={messages}
            onActivate={onActivate}
            activeMessageId={activeMessageId}
            onOpenDrawer={isMobile ? onOpenDrawer : undefined}
          />
        )}
        <ChatInput
          onSend={handleSend}
          disabled={sending}
          showQuickActions={isMobile && isEmpty}
          onLocationAcquired={handleLocationAcquired}
        />
      </div>
    </div>
  );
}
