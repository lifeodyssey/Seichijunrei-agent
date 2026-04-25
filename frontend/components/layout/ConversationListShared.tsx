"use client";

import type { ConversationRecord } from "@/lib/types";
import { getConversationDisplayTitle } from "../../lib/conversation-history";
import { relativeTime } from "../../lib/time-utils";
import { useDict } from "../../lib/i18n-context";

/** Route-related keywords used to select the pin icon. */
const ROUTE_KEYWORDS = /route|ルート|路线|plan|計画|计划/i;

interface ConversationItemProps {
  record: ConversationRecord;
  isActive: boolean;
  onSelect: () => void;
}

export function ConversationItem({ record, isActive, onSelect }: ConversationItemProps) {
  const displayTitle = getConversationDisplayTitle(record);
  const icon = ROUTE_KEYWORDS.test(record.first_query) ? "\u{1F4CD}" : "\u{1F5FE}";
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

export function EmptyConversations() {
  const { drawer: t } = useDict();
  return (
    <div
      data-testid="conversation-drawer-empty"
      className="flex flex-col items-center justify-center h-32 gap-2 text-[var(--color-muted-fg)]"
    >
      <span className="text-2xl" aria-hidden="true">{"\u{1F5FE}"}</span>
      <p className="text-xs text-center">
        {t.empty}
      </p>
    </div>
  );
}

interface ConversationListProps {
  conversations: ConversationRecord[];
  activeSessionId: string | null;
  onSelectConversation: (sessionId: string) => void;
  onItemClick?: () => void;
}

export function ConversationList({
  conversations,
  activeSessionId,
  onSelectConversation,
  onItemClick,
}: ConversationListProps) {
  const { drawer: t } = useDict();
  if (conversations.length === 0) return <EmptyConversations />;

  return (
    <>
      <p className="pb-2 text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted-fg)] opacity-60">
        {t.recent}
      </p>
      {conversations.map((record) => (
        <ConversationItem
          key={record.session_id}
          record={record}
          isActive={record.session_id === activeSessionId}
          onSelect={() => {
            onSelectConversation(record.session_id);
            onItemClick?.();
          }}
        />
      ))}
    </>
  );
}
