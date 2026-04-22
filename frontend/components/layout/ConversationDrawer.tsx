"use client";

import type { ConversationRecord } from "@/lib/types";
import { getConversationDisplayTitle } from "../../lib/conversation-history";
import { relativeTime } from "../../lib/time-utils";

interface ConversationDrawerProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationRecord[];
  activeSessionId: string | null;
  onSelectConversation: (sessionId: string) => void;
  onNewChat: () => void;
}

/** Route-related keywords used to select the 📍 icon. */
const ROUTE_KEYWORDS = /route|ルート|路线|plan|計画|计划/i;

interface ConversationItemProps {
  record: ConversationRecord;
  isActive: boolean;
  onSelect: () => void;
}

function ConversationItem({ record, isActive, onSelect }: ConversationItemProps) {
  const displayTitle = getConversationDisplayTitle(record);
  const icon = ROUTE_KEYWORDS.test(record.first_query) ? "📍" : "🗾";
  const meta = relativeTime(record.updated_at);

  return (
    <div
      key={record.session_id}
      data-testid={`conversation-item-${record.session_id}`}
      data-active={isActive || undefined}
      className={[
        "mb-0.5 flex items-start gap-2 rounded-[var(--r-lg)] px-3 py-2.5 cursor-pointer transition",
        isActive
          ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
          : "hover:bg-[var(--color-muted)]",
      ].join(" ")}
      onClick={onSelect}
    >
      <span className="mt-0.5 shrink-0 text-sm leading-none" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={[
            "truncate text-xs font-medium",
            isActive ? "text-[var(--color-primary-fg)]" : "text-[var(--color-fg)]",
          ].join(" ")}
        >
          {displayTitle.length > 25
            ? displayTitle.slice(0, 25) + "\u2026"
            : displayTitle}
        </p>
        {meta && (
          <p
            className={[
              "mt-0.5 text-[10px]",
              isActive ? "text-[var(--color-primary-fg)] opacity-70" : "text-[var(--color-muted-fg)] opacity-60",
            ].join(" ")}
          >
            {meta}
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyConversations() {
  return (
    <div
      data-testid="conversation-drawer-empty"
      className="flex flex-col items-center justify-center h-32 gap-2 text-[var(--color-muted-fg)]"
    >
      <span className="text-2xl" aria-hidden="true">🗾</span>
      <p className="text-xs text-center">
        まだ会話がありません
      </p>
    </div>
  );
}

interface ConversationListProps {
  conversations: ConversationRecord[];
  activeSessionId: string | null;
  onSelectConversation: (sessionId: string) => void;
  onClose: () => void;
}

function ConversationList({
  conversations,
  activeSessionId,
  onSelectConversation,
  onClose,
}: ConversationListProps) {
  if (conversations.length === 0) return <EmptyConversations />;

  return (
    <>
      <p className="pb-2 text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted-fg)] opacity-60">
        最近
      </p>
      {conversations.map((record) => (
        <ConversationItem
          key={record.session_id}
          record={record}
          isActive={record.session_id === activeSessionId}
          onSelect={() => {
            onSelectConversation(record.session_id);
            onClose();
          }}
        />
      ))}
    </>
  );
}

/**
 * Mobile-only left-side conversation history drawer.
 * Triggered by hamburger icon tap. 280px wide, slides in from left.
 * Only renders on mobile (<1024px) — caller controls visibility via `open` prop.
 */
export default function ConversationDrawer({
  open,
  onClose,
  conversations,
  activeSessionId,
  onSelectConversation,
  onNewChat,
}: ConversationDrawerProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        role="button"
        tabIndex={0}
        aria-label="Close conversation drawer"
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
            履歴
          </span>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-[var(--color-muted)] transition"
            aria-label="Close conversation drawer"
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
            + 新しいチャット
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-4 pt-2">
          <ConversationList
            conversations={conversations}
            activeSessionId={activeSessionId}
            onSelectConversation={onSelectConversation}
            onClose={onClose}
          />
        </div>
      </div>
    </>
  );
}
