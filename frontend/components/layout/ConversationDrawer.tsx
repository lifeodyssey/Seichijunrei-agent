"use client";

import type { ConversationRecord } from "@/lib/types";
import { ConversationList } from "./ConversationListShared";
import { useDict } from "../../lib/i18n-context";

interface ConversationDrawerProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationRecord[];
  activeSessionId: string | null;
  onSelectConversation: (sessionId: string) => void;
  onNewChat: () => void;
}

/**
 * Mobile-only left-side conversation history drawer.
 * Triggered by hamburger icon tap. 280px wide, slides in from left.
 * Only renders on mobile (<1024px) -- caller controls visibility via `open` prop.
 */
export default function ConversationDrawer({
  open,
  onClose,
  conversations,
  activeSessionId,
  onSelectConversation,
  onNewChat,
}: ConversationDrawerProps) {
  const { drawer: t } = useDict();
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-40"
        style={{ background: "color-mix(in oklch, var(--color-fg) 30%, transparent)" }}
        onClick={onClose}
        aria-label={t.close}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      />

      {/* Drawer panel */}
      <div
        className="fixed inset-y-0 left-0 z-50 flex flex-col bg-[var(--color-bg)] shadow-xl"
        style={{ width: 280 }}
        role="dialog"
        aria-label="Conversation history"
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-4 shrink-0">
          <span
            className="font-[family-name:var(--app-font-display)] text-base font-semibold text-[var(--color-fg)]"
          >
            {t.title}
          </span>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-[var(--color-muted)] transition"
            aria-label={t.close}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M4 4l10 10M14 4L4 14" />
            </svg>
          </button>
        </div>

        {/* New chat */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <button
            onClick={() => { onNewChat(); onClose(); }}
            className="w-full rounded-lg border border-[var(--color-border)] py-2 text-left text-sm font-light text-[var(--color-fg)] px-3 hover:bg-[var(--color-muted)] transition"
          >
            {t.new_chat}
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-4 pt-2">
          <ConversationList
            conversations={conversations}
            activeSessionId={activeSessionId}
            onSelectConversation={onSelectConversation}
            onItemClick={onClose}
          />
        </div>
      </div>
    </>
  );
}
