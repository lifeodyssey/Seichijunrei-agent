"use client";

import type { PilgrimagePoint } from "../../lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnimeGroup {
  bangumi_id: string;
  title: string;
  points_count: number;
  color_index: number;
}

interface NearbyChipsProps {
  groups: AnimeGroup[];
  /** The currently-active bangumi_id filter, or null for "show all". */
  activeId: string | null;
  /** Called with bangumi_id to activate, or null to deactivate (toggle off). */
  onSelect: (bangumiId: string | null) => void;
}

// ---------------------------------------------------------------------------
// Color palette — cycles through 6 distinct hues matching map pin colors.
// ---------------------------------------------------------------------------

export const CHIP_COLORS: {
  bg: string;
  text: string;
  dot: string;
  activeBg: string;
  activeText: string;
}[] = [
  {
    bg: "bg-transparent border border-blue-300",
    text: "text-blue-700",
    dot: "bg-blue-500",
    activeBg: "bg-blue-500",
    activeText: "text-white",
  },
  {
    bg: "bg-transparent border border-emerald-300",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    activeBg: "bg-emerald-500",
    activeText: "text-white",
  },
  {
    bg: "bg-transparent border border-orange-300",
    text: "text-orange-700",
    dot: "bg-orange-500",
    activeBg: "bg-orange-500",
    activeText: "text-white",
  },
  {
    bg: "bg-transparent border border-purple-300",
    text: "text-purple-700",
    dot: "bg-purple-500",
    activeBg: "bg-purple-500",
    activeText: "text-white",
  },
  {
    bg: "bg-transparent border border-pink-300",
    text: "text-pink-700",
    dot: "bg-pink-500",
    activeBg: "bg-pink-500",
    activeText: "text-white",
  },
  {
    bg: "bg-transparent border border-teal-300",
    text: "text-teal-700",
    dot: "bg-teal-500",
    activeBg: "bg-teal-500",
    activeText: "text-white",
  },
];

// ---------------------------------------------------------------------------
// Helper: group points by bangumi_id
// ---------------------------------------------------------------------------

export function groupByAnime(points: PilgrimagePoint[]): AnimeGroup[] {
  const order: string[] = [];
  const map = new Map<string, { title: string; count: number }>();

  for (const point of points) {
    const key = point.bangumi_id ?? "";
    if (!map.has(key)) {
      order.push(key);
      map.set(key, { title: point.title ?? key, count: 0 });
    }
    const entry = map.get(key)!;
    entry.count += 1;
  }

  return order.map((key, index) => {
    const entry = map.get(key)!;
    return {
      bangumi_id: key,
      title: entry.title,
      points_count: entry.count,
      color_index: index % CHIP_COLORS.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a horizontal row of anime filter chips above the nearby map.
 *
 * - Returns null when there are 0 or 1 distinct anime (no filtering needed).
 * - Groups with points_count === 0 are excluded.
 * - Tapping an active chip toggles it off (calls onSelect with null).
 */
export default function NearbyChips({
  groups,
  activeId,
  onSelect,
}: NearbyChipsProps) {
  const visible = groups.filter((g) => g.points_count > 0);

  // No chip row needed for 0 or 1 anime.
  if (visible.length <= 1) return null;

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="アニメフィルター"
    >
      {visible.map((group) => {
        const color = CHIP_COLORS[group.color_index % CHIP_COLORS.length];
        const isActive = activeId === group.bangumi_id;

        return (
          <button
            key={group.bangumi_id}
            type="button"
            aria-pressed={isActive}
            onClick={() =>
              onSelect(isActive ? null : group.bangumi_id)
            }
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? `${color.activeBg} ${color.activeText}`
                : `${color.bg} ${color.text}`
            }`}
            style={{ transitionDuration: "var(--duration-fast, 150ms)" }}
          >
            <span
              data-testid="chip-dot"
              className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`}
              aria-hidden="true"
            />
            <span className="max-w-[120px] truncate">{group.title}</span>
            <span className="shrink-0 opacity-80">{group.points_count}</span>
          </button>
        );
      })}
    </div>
  );
}
