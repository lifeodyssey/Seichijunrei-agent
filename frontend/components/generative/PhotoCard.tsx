"use client";

import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// EpisodeBadge
// ---------------------------------------------------------------------------

export function EpisodeBadge({ episode }: { episode: number | null }) {
  const { grid: t } = useDict();
  if (episode == null) return null;
  return (
    <span className="absolute left-2 top-2 rounded-[5px] bg-[var(--color-fg)]/55 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-bg)] backdrop-blur-[4px]">
      {t.episode.replace("{ep}", String(episode))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PhotoCard
// ---------------------------------------------------------------------------

interface PhotoCardProps {
  point: PilgrimagePoint;
  selected: boolean;
  onToggle: (id: string) => void;
  onDetail?: (point: PilgrimagePoint) => void;
}

export function PhotoCard({ point, selected, onToggle, onDetail }: PhotoCardProps) {
  return (
    <div
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-[var(--r-lg)] border-2 bg-[var(--color-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        selected ? "border-[var(--color-primary)]" : "border-transparent"
      )}
      onClick={() => onToggle(point.id)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(point.id);
        }
      }}
    >
      {/* Detail button — visible on hover */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDetail?.(point); }}
        className="absolute left-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-bg)] text-[var(--color-muted-fg)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-[var(--color-primary)]"
        aria-label="查看详情"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </button>
      {/* Image — 16/10 aspect ratio */}
      <div className="relative aspect-[16/10] overflow-hidden">
        {point.screenshot_url ? (
          <img
            src={point.screenshot_url}
            alt={point.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="h-full w-full bg-[var(--color-muted)]" />
        )}
        <EpisodeBadge episode={point.episode} />
        {selected && (
          <div className="absolute right-2 top-2 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-[var(--color-bg)]">
            ✓
          </div>
        )}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="truncate text-[13px] font-medium text-[var(--color-fg)]">
          {point.name}
        </p>
        {point.title && (
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted-fg)]">
            {point.title}
          </p>
        )}
      </div>
    </div>
  );
}
