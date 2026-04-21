"use client";

import type { ChatMessage } from "../../lib/types";
import type { Dict, Locale } from "../../lib/i18n";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";

interface ChatPopupProps {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  sending: boolean;
  activeMessageId: string | null;
  dict: Dict;
  locale: Locale;
  onSend: (text: string, coords?: { lat: number; lng: number } | null) => void;
  onActivate: (messageId: string) => void;
}

/**
 * Floating chat popup — 340×400px, bottom-right, per DESIGN.md.
 *
 * Not a side panel. Content behind stays full-width.
 * Appears with scale+opacity transition. Click backdrop or X to close.
 */
export default function ChatPopup({
  open,
  onClose,
  messages,
  sending,
  activeMessageId,
  onSend,
  onActivate,
}: ChatPopupProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop — transparent, just catches clicks */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden
      />

      {/* Popup */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)]"
        style={{
          bottom: "24px",
          right: "24px",
          width: "340px",
          height: "400px",
          borderRadius: "var(--r-lg)",
          boxShadow: "0 8px 32px oklch(20% 0.02 238 / 0.15)",
          animation: "popup-enter 0.2s var(--ease-out-expo)",
        }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
          <h3
            className="text-sm font-semibold text-[var(--color-fg)]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            对话
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭对话"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-muted-fg)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Messages — scrollable */}
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageList
            messages={messages}
            onActivate={onActivate}
            activeMessageId={activeMessageId}
          />
        </div>

        {/* Input */}
        <ChatInput
          onSend={(text) => onSend(text)}
          disabled={sending}
        />
      </div>
    </>
  );
}
