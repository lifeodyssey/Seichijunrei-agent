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
  onSelectConversation?: (sessionId: string) => void;
  routes?: RouteHistoryEntry[];
  onCollapse?: () => void;
}

interface RouteHistoryEntry {
  id: string;
  bangumi_id: string;
  bangumi_title: string | null;
  origin_station: string | null;
  point_count: number;
  created_at: string;
}

const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  zh: "中文",
  en: "EN",
};

/** Route-related keywords used to select the 📍 icon. */
const ROUTE_KEYWORDS = /route|ルート|路线|plan|計画|计划/i;

/** Locale-aware relative time string from an ISO date. */
function relativeTime(dateStr: string | undefined | null, locale: string): string {
  if (!dateStr) return "";
  const parsed = new Date(dateStr).getTime();
  if (Number.isNaN(parsed)) return "";
  const diff = Date.now() - parsed;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return locale === "ja" ? "たった今" : locale === "zh" ? "刚刚" : "just now";
  if (mins < 60) return locale === "ja" ? `${mins}分前` : locale === "zh" ? `${mins}分钟前` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return locale === "ja" ? `${hours}時間前` : locale === "zh" ? `${hours}小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return locale === "ja" ? `${days}日前` : locale === "zh" ? `${days}天前` : `${days}d ago`;
}

/** Truncate a string to `max` characters, appending ellipsis if needed. */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\u2026" : text;
}

function ConversationItem({
  active,
  record,
  renameHint,
  locale,
  spotsLabel,
  onRename,
  onClick,
}: {
  active: boolean;
  record: ConversationRecord;
  renameHint: string;
  locale: string;
  spotsLabel: string;
  onRename: (sessionId: string, title: string) => void;
  onClick?: (sessionId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(getConversationDisplayTitle(record));
  const inputRef = useRef<HTMLInputElement>(null);
  const displayTitle = getConversationDisplayTitle(record);

  /** Show user-renamed title if available, otherwise first_query, fallback to displayTitle. */
  const hasCustomTitle = record.title && record.title !== record.first_query;
  const itemTitle = truncate(hasCustomTitle ? record.title : (record.first_query || displayTitle), 25);
  /** Pick icon based on whether first_query mentions route/plan keywords. */
  const icon = ROUTE_KEYWORDS.test(record.first_query) ? "\uD83D\uDCCD" : "\uD83D\uDDFE";

  useEffect(() => {
    if (!editing) return;

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [editing]);

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
      setDraftTitle(displayTitle);
      setEditing(true);
    },
    [displayTitle],
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

  const meta = relativeTime(record.updated_at, locale);

  return (
    <div
      className={[
        "group mb-0.5 flex min-h-[52px] items-start gap-2 rounded-lg px-3 py-2.5 transition",
        active
          ? "bg-[var(--color-sidebar-accent)]"
          : "hover:bg-[var(--color-sidebar-accent)]",
      ].join(" ")}
      style={{ transitionDuration: "var(--duration-fast)", cursor: "pointer" }}
      onClick={editing ? undefined : () => onClick?.(record.session_id)}
      onDoubleClick={editing ? undefined : handleDoubleClick}
      title={editing ? undefined : renameHint}
    >
      {/* Icon */}
      <span className="mt-0.5 shrink-0 text-sm leading-none" aria-hidden>
        {icon}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
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
            <p className="truncate text-xs font-medium text-[var(--color-sidebar-accent-fg)]">
              {itemTitle}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-[var(--color-sidebar-fg)] opacity-60">
              {meta} {spotsLabel ? ` \u00B7 ${spotsLabel}` : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Deduplicate conversations by session_id, keeping the first occurrence. */
function deduplicateConversations(
  conversations: ConversationRecord[],
): ConversationRecord[] {
  const seen = new Set<string>();
  return conversations.filter((record) => {
    if (seen.has(record.session_id)) return false;
    seen.add(record.session_id);
    return true;
  });
}

export default function Sidebar({
  conversations,
  activeSessionId,
  onNewChat,
  onRenameConversation,
  onSelectConversation,
  routes,
  onCollapse,
}: SidebarProps) {
  const { sidebar: t } = useDict();
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-sidebar)] lg:flex">
      {/* Logo + collapse toggle */}
      <div className="flex h-16 items-center justify-between border-b border-[var(--color-sidebar-border)] px-5">
        <div className="flex flex-col gap-0.5">
          <span className="font-[family-name:var(--app-font-display)] text-lg font-semibold leading-none text-[var(--color-fg)]">
            聖地巡礼
          </span>
          <span className="text-[9px] font-light tracking-[0.20em] text-[var(--color-muted-fg)]">
            seichijunrei
          </span>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="rounded-lg p-2 hover:bg-[var(--color-primary)]/5 transition"
            style={{ transitionDuration: "var(--duration-fast)" }}
            aria-label="Collapse sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
        )}
      </div>

      {/* New chat button */}
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
            {deduplicateConversations(conversations).map((record) => (
              <ConversationItem
                key={record.session_id}
                active={record.session_id === activeSessionId}
                record={record}
                renameHint={t.rename_hint}
                locale={locale}
                spotsLabel=""
                onRename={onRenameConversation}
                onClick={onSelectConversation}
              />
            ))}
          </>
        )}
      </div>

      {/* Route history */}
      {routes && routes.length > 0 && (
        <div className="border-t border-[var(--color-sidebar-border)] px-4 pt-3">
          <p className="pb-2 text-[10px] font-medium uppercase tracking-widest text-[var(--color-sidebar-fg)] opacity-60">
            {t.route_history ?? "Route History"}
          </p>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto">
            {routes.map((route) => (
              <li key={route.id}>
                <div className="truncate py-1.5 text-xs font-light text-[var(--color-sidebar-accent-fg)]">
                  {route.bangumi_title ?? route.bangumi_id} &mdash;{" "}
                  {t.spots?.replace("{count}", String(route.point_count)) ??
                    `${route.point_count} spots`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer — 44px locale switcher buttons */}
      <div className="border-t border-[var(--color-sidebar-border)] px-5 py-4">
        <div className="flex items-center gap-2">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              data-active={locale === l}
              className="min-h-[44px] min-w-[44px] rounded-full px-3 py-2 text-[10px] font-light tracking-wide transition data-[active=true]:bg-[var(--color-primary)] data-[active=true]:text-white hover:bg-[var(--color-primary)]/10"
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
