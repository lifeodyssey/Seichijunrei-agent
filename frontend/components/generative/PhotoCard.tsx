"use client";

import type { PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";

// ---------------------------------------------------------------------------
// EpisodeBadge
// ---------------------------------------------------------------------------

export function EpisodeBadge({ episode }: { episode: number | null }) {
  const { grid: t } = useDict();
  if (episode == null) return null;
  return (
    <span
      className="absolute left-2 top-2 rounded-[5px] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
    >
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
}

export function PhotoCard({ point, selected, onToggle }: PhotoCardProps) {
  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-[10px] bg-[var(--color-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ border: `2px solid ${selected ? "var(--color-primary)" : "transparent"}` }}
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
      {/* Image — 16/10 aspect ratio */}
      <div className="relative overflow-hidden" style={{ aspectRatio: "16/10" }}>
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
          <div className="absolute right-2 top-2 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-white">
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
