"use client";

import { useDict } from "../../lib/i18n-context";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface ChatHeaderProps {
  onToggleMap?: () => void;
  mapOpen?: boolean;
}

export default function ChatHeader({ onToggleMap, mapOpen }: ChatHeaderProps) {
  const { header: t } = useDict();
  const pathname = usePathname();
  const currentLang = pathname.startsWith("/zh") ? "zh" : "ja";
  const otherLang = currentLang === "ja" ? "zh" : "ja";
  const otherPath = pathname.replace(`/${currentLang}`, `/${otherLang}`);

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-6">
      <div>
        <h1 className="text-sm font-semibold text-[var(--color-fg)]">{t.title}</h1>
        <p className="text-xs text-[var(--color-muted-fg)]">
          {t.subtitle}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={otherPath}
          className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-secondary)]"
        >
          {otherLang === "zh" ? "中文" : "日本語"}
        </Link>
        {onToggleMap && (
          <button
            onClick={onToggleMap}
            className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-secondary)]"
          >
            {mapOpen ? t.map_open : t.map_closed}
          </button>
        )}
      </div>
    </header>
  );
}
