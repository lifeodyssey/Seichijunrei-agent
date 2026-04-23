"use client";

import { useEffect, useState } from "react";
import { useDict } from "../../lib/i18n-context";

interface SelectionBarProps {
  count: number;
  defaultOrigin: string;
  onRoute: (origin: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

export default function SelectionBar({
  count,
  defaultOrigin,
  onRoute,
  onClear,
  disabled = false,
}: SelectionBarProps) {
  const { selection: t } = useDict();
  const [origin, setOrigin] = useState(defaultOrigin);

  useEffect(() => {
    setOrigin(defaultOrigin);
  }, [defaultOrigin]);

  const handleRoute = () => {
    if (disabled || count === 0) return;
    onRoute(origin);
  };

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-card)] px-5 py-2.5">
      <span className="shrink-0 text-[11px] font-medium text-[var(--color-primary)]">
        {t.count.replace("{count}", String(count))}
      </span>
      <input
        value={origin}
        onChange={(event) => setOrigin(event.target.value)}
        aria-label={t.placeholder}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            handleRoute();
          }
        }}
        placeholder={t.placeholder}
        className="min-w-0 flex-1 rounded-sm bg-[var(--color-muted)] px-2 py-1 text-xs text-[var(--color-fg)] outline-none placeholder:text-[var(--color-muted-fg)] focus:ring-1 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={handleRoute}
        className="shrink-0 rounded-[var(--r-sm)] bg-[var(--color-primary)] px-3 py-1 text-[11px] font-medium text-[var(--color-primary-fg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ transitionDuration: "var(--duration-fast)" }}
        disabled={disabled || count === 0}
      >
        {t.route}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 text-xs text-[var(--color-muted-fg)] transition hover:text-[var(--color-fg)] disabled:cursor-not-allowed disabled:opacity-40"
        style={{ transitionDuration: "var(--duration-fast)" }}
        disabled={disabled}
      >
        {t.clear}
      </button>
    </div>
  );
}
