"use client";

import type { RouteHistoryRecord } from "../../lib/types";
import { useDict, useLocale, useSetLocale } from "../../lib/i18n-context";
import { LOCALES, type Locale } from "../../lib/i18n";

interface SidebarProps {
  routeHistory: RouteHistoryRecord[];
  bangumiTitleMap?: Map<string, string>;
  onNewChat: () => void;
}

const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  zh: "中文",
  en: "EN",
};

export default function Sidebar({ routeHistory, bangumiTitleMap, onNewChat }: SidebarProps) {
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

      {/* Route history — numbered list */}
      <div className="flex-1 overflow-y-auto px-4 pt-5">
        {routeHistory.length > 0 && (
          <>
            <p className="pb-3 text-[10px] font-medium uppercase tracking-widest text-[var(--color-sidebar-fg)] opacity-60">
              {t.recent}
            </p>
            {routeHistory.map((record, idx) => (
              <div
                key={record.route_id ?? idx}
                className="group mb-0.5 flex items-baseline gap-2.5 border-l-2 border-transparent py-2 pl-2 pr-1 transition hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-sidebar-accent)]"
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                <span className="shrink-0 text-[10px] font-medium text-[var(--color-primary)]">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-light text-[var(--color-sidebar-accent-fg)]">
                    {bangumiTitleMap?.get(record.bangumi_id) ?? record.bangumi_id}
                  </p>
                  <p className="text-[10px] text-[var(--color-sidebar-fg)]">
                    {t.spots.replace("{count}", String(record.point_count))}
                  </p>
                </div>
              </div>
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
