"use client";

interface ChatHeaderProps {
  onToggleMap?: () => void;
  mapOpen?: boolean;
}

export default function ChatHeader({ onToggleMap, mapOpen }: ChatHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-6">
      <div>
        <h1 className="text-sm font-semibold text-[var(--color-fg)]">聖地巡礼 AI</h1>
        <p className="text-xs text-[var(--color-muted-fg)]">
          動漫聖地を探す · ルートを計画する
        </p>
      </div>
      {onToggleMap && (
        <button
          onClick={onToggleMap}
          className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-secondary)]"
        >
          {mapOpen ? "地図を閉じる" : "地図"}
        </button>
      )}
    </header>
  );
}
