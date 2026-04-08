"use client";

import { useDict, useLocale, useSetLocale } from "../../lib/i18n-context";
import { LOCALES } from "../../lib/i18n";

interface ChatHeaderProps {
  onNewChat?: () => void;
  onMenuToggle?: () => void;
}

export default function ChatHeader({ onNewChat, onMenuToggle }: ChatHeaderProps) {
  const { header: t, sidebar: s } = useDict();
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-5">
      <div className="flex items-center gap-2">
        {onMenuToggle && (
          <button
            type="button"
            onClick={onMenuToggle}
            className="rounded-lg p-2 hover:bg-[var(--color-primary)]/5 transition"
            style={{ transitionDuration: "var(--duration-fast)" }}
            aria-label="Toggle sidebar"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14" />
            </svg>
          </button>
        )}
        <h1 className="font-[family-name:var(--app-font-display)] text-sm font-semibold text-[var(--color-fg)]">
          {t.title}
        </h1>
        <div className="flex gap-0.5 rounded-md border border-[var(--color-border)] p-0.5">
          {LOCALES.map((loc) => (
            <button
              type="button"
              key={loc}
              onClick={() => setLocale(loc)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                locale === loc
                  ? "bg-white font-semibold text-[var(--color-fg)] shadow-sm"
                  : "text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
              }`}
            >
              {loc === "ja" ? "\u65E5\u672C\u8A9E" : loc === "zh" ? "\u4E2D\u6587" : "EN"}
            </button>
          ))}
        </div>
      </div>
      {onNewChat && (
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-md px-3 py-1.5 text-xs font-light text-[var(--color-primary)] transition hover:bg-[var(--color-muted)]"
          style={{ transitionDuration: "var(--duration-fast)" }}
        >
          {s.new_chat}
        </button>
      )}
    </header>
  );
}
