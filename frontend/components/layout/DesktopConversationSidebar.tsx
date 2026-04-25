"use client";

import type { ConversationRecord } from "@/lib/types";
import { ConversationList } from "./ConversationListShared";
import { useDict } from "../../lib/i18n-context";

interface DesktopConversationSidebarProps {
  conversations: ConversationRecord[];
  activeSessionId: string | null;
  onSelectConversation: (sessionId: string) => void;
  onNewChat: () => void;
}

/**
 * Desktop-only persistent conversation sidebar.
 * 260px wide, always visible on lg+ screens, hidden on mobile/tablet.
 */
export default function DesktopConversationSidebar({
  conversations,
  activeSessionId,
  onSelectConversation,
  onNewChat,
}: DesktopConversationSidebarProps) {
  const { drawer: t } = useDict();

  return (
    <div
      className="hidden lg:flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)] shrink-0"
      style={{ width: 260 }}
      data-testid="desktop-conversation-sidebar"
    >
      {/* Header */}
      <div className="flex h-14 items-center border-b border-[var(--color-border)] px-4 shrink-0">
        <span className="font-[family-name:var(--app-font-display)] text-base font-semibold text-[var(--color-fg)]">
          {t.title}
        </span>
      </div>

      {/* New chat */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <button
          data-testid="desktop-sidebar-new-chat"
          onClick={onNewChat}
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
        />
      </div>
    </div>
  );
}
