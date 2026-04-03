"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { getConversationDisplayTitle } from "../../lib/conversation-history";
import type { ConversationRecord } from "../../lib/types";
import { useDict, useLocale, useSetLocale } from "../../lib/i18n-context";
import { LOCALES, type Locale } from "../../lib/i18n";

interface SidebarProps {
  conversations: ConversationRecord[];
  activeSessionId: string | null;
  onNewChat: () => void;
  onRenameConversation: (sessionId: string, title: string) => void;
}

const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  zh: "中文",
  en: "EN",
};

function ConversationItem({
  active,
  record,
  renameHint,
  onRename,
}: {
  active: boolean;
  record: ConversationRecord;
  renameHint: string;
  onRename: (sessionId: string, title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(getConversationDisplayTitle(record));
  const inputRef = useRef<HTMLInputElement>(null);
  const displayTitle = getConversationDisplayTitle(record);

  useEffect(() => {
    if (!editing) {
      setDraftTitle(displayTitle);
      return;
    }

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [displayTitle, editing]);

  const cancelEditing = useCallback(() => {
    setDraftTitle(displayTitle);
    setEditing(false);
  }, [displayTitle]);

  const commitEditing = useCallback(() => {
    const trimmedTitle = draftTitle.trim();
    if (!trimmedTitle) {
      cancelEditing();
      return;
    }

    if (trimmedTitle !== displayTitle) {
      onRename(record.session_id, trimmedTitle);
    }
    setEditing(false);
  }, [cancelEditing, displayTitle, draftTitle, onRename, record.session_id]);

  const handleDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      setEditing(true);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitEditing();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        cancelEditing();
      }
    },
    [cancelEditing, commitEditing],
  );

  return (
    <div
      className={[
        "group mb-0.5 border-l-2 py-2 pl-3 pr-2 transition",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-sidebar-accent)]"
          : "border-transparent hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-sidebar-accent)]",
      ].join(" ")}
      style={{ transitionDuration: "var(--duration-fast)" }}
      onDoubleClick={editing ? undefined : handleDoubleClick}
      title={editing ? undefined : renameHint}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitEditing}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-xs font-light text-[var(--color-sidebar-accent-fg)] outline-none"
        />
      ) : (
        <>
          <p className="truncate text-xs font-light text-[var(--color-sidebar-accent-fg)]">
            {displayTitle}
          </p>
          <p className="mt-1 text-[10px] text-[var(--color-sidebar-fg)] opacity-0 transition group-hover:opacity-60">
            {renameHint}
          </p>
        </>
      )}
    </div>
  );
}

export default function Sidebar({
  conversations,
  activeSessionId,
  onNewChat,
  onRenameConversation,
}: SidebarProps) {
  const { sidebar: t } = useDict();
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)] lg:flex">
      {/* Logo — 聖地巡礼 + seichijunrei romaji */}
      <div className="flex h-16 items-center border-b border-[var(--color-sidebar-border)] px-5">
        <div className="flex flex-col gap-0.5">
          <span className="font-[family-name:var(--app-font-display)] text-lg font-semibold leading-none text-[var(--color-fg)]">
            聖地巡礼
          </span>
          <span className="text-[9px] font-light tracking-[0.20em] text-[var(--color-muted-fg)]">
            seichijunrei
          </span>
        </div>
      </div>

      {/* New chat button — flat, editorial */}
      <div className="px-4 pt-4">
        <button
          onClick={onNewChat}
          className="w-full border-b border-transparent py-2 text-left text-sm font-light text-[var(--color-sidebar-fg)] transition hover:border-[var(--color-primary)]/40 hover:text-[var(--color-sidebar-accent-fg)]"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          + {t.new_chat.replace(/^\+\s*/, "")}
        </button>
      </div>

      {/* Conversation history */}
      <div className="flex-1 overflow-y-auto px-4 pt-5">
        {conversations.length > 0 && (
          <>
            <p className="pb-3 text-[10px] font-medium uppercase tracking-widest text-[var(--color-sidebar-fg)] opacity-60">
              {t.recent}
            </p>
            {conversations.map((record) => (
              <ConversationItem
                key={record.session_id}
                active={record.session_id === activeSessionId}
                record={record}
                renameHint={t.rename_hint}
                onRename={onRenameConversation}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer — language switcher + diamond mark */}
      <div className="border-t border-[var(--color-sidebar-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={[
                "text-[10px] font-light tracking-wide transition",
                locale === l
                  ? "text-[var(--color-primary)]"
                  : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]",
              ].join(" ")}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {LOCALE_LABELS[l]}
            </button>
          ))}
          <span className="ml-auto text-sm text-[var(--color-primary)] opacity-30">◈</span>
        </div>
      </div>
    </aside>
  );
}
