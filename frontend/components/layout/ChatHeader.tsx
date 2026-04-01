"use client";

import { useDict } from "../../lib/i18n-context";

interface ChatHeaderProps {
  onNewChat?: () => void;
}

export default function ChatHeader({ onNewChat }: ChatHeaderProps) {
  const { header: t, sidebar: s } = useDict();

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-5">
      <h1 className="font-[family-name:var(--app-font-display)] text-sm font-semibold text-[var(--color-fg)]">
        {t.title}
      </h1>
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
