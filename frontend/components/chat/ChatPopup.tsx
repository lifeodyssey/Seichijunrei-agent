"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "../../lib/types";
import type { Dict, Locale } from "../../lib/i18n";
import { useDict } from "../../lib/i18n-context";
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
 * Draggable floating chat popup — 340×440px.
 *
 * Header is a drag handle: pointerdown starts tracking, pointermove updates
 * position via transform (GPU-composited), pointerup stops.
 *
 * No backdrop — users can interact with content behind the popup.
 * Close via the × button or minimize.
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
  const { chat_popup: t } = useDict();
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  // Track dragging state reactively so render can read it without accessing ref.current
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: pos.x,
        originY: pos.y,
      };
      setIsDragging(true);
    },
    [pos],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({
      x: dragRef.current.originX + dx,
      y: dragRef.current.originY + dy,
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // Track whether this is a drag (suppress click if dragged)
  const didDragRef = useRef(false);

  const handlePillPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      didDragRef.current = false;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: pos.x,
        originY: pos.y,
      };
    },
    [pos],
  );

  const handlePillPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true;
    setPos({
      x: dragRef.current.originX + dx,
      y: dragRef.current.originY + dy,
    });
  }, []);

  const handlePillPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handlePillClick = useCallback(() => {
    if (!didDragRef.current) onClose(); // toggle open
  }, [onClose]);

  // Minimized state — draggable floating pill to reopen
  if (!open) {
    return (
      <button
        type="button"
        onClick={handlePillClick}
        onPointerDown={handlePillPointerDown}
        onPointerMove={handlePillPointerMove}
        onPointerUp={handlePillPointerUp}
        className="fixed z-50 flex h-10 items-center gap-2 rounded-full bg-[var(--color-primary)] px-4 text-sm font-medium text-white shadow-lg"
        style={{
          bottom: `${72 - pos.y}px`,
          right: `${24 - pos.x}px`,
          animation: "pop-in 0.25s var(--ease-out-expo)",
          cursor: "grab",
          touchAction: "none",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {t.continue}
      </button>
    );
  }

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg)]"
      style={{
        bottom: `${72 - pos.y}px`,
        right: `${24 - pos.x}px`,
        width: "340px",
        height: "420px",
        borderRadius: "var(--r-lg)",
        boxShadow: "0 8px 32px oklch(20% 0.02 238 / 0.18)",
        animation: pos.x === 0 && pos.y === 0 ? "popup-enter 0.2s var(--ease-out-expo)" : undefined,
      }}
    >
      {/* Header — drag handle */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5"
        style={{ cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-[var(--color-muted-fg)]" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <h3
            className="select-none text-sm font-semibold text-[var(--color-fg)]"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            {t.title}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {/* Drag indicator dots */}
          <div className="flex flex-col gap-0.5 px-2 opacity-30" aria-hidden>
            <div className="flex gap-0.5">
              <span className="block h-1 w-1 rounded-full bg-current" />
              <span className="block h-1 w-1 rounded-full bg-current" />
            </div>
            <div className="flex gap-0.5">
              <span className="block h-1 w-1 rounded-full bg-current" />
              <span className="block h-1 w-1 rounded-full bg-current" />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--color-muted-fg)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
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
        placeholderOverride={t.continue}
      />
    </div>
  );
}
