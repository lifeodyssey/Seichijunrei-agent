"use client";

import type { PilgrimagePoint } from "../../lib/types";
import { colorValue } from "../../lib/color";

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
// Color palette — 6 distinct hues using CSS oklch values.
// Shape is kept stable so existing tests can introspect the properties.
// ---------------------------------------------------------------------------

export const CHIP_COLORS: {
  bg: string;
  text: string;
  dot: string;
  activeBg: string;
  activeText: string;
  hue: number;
  chroma: number;
}[] = [
  { hue: 240, chroma: 0.148, bg: "chip-color-0-bg", text: "chip-color-0-text", dot: "chip-color-0-dot", activeBg: "chip-color-0-active-bg", activeText: "chip-color-0-active-text" },
  { hue: 160, chroma: 0.130, bg: "chip-color-1-bg", text: "chip-color-1-text", dot: "chip-color-1-dot", activeBg: "chip-color-1-active-bg", activeText: "chip-color-1-active-text" },
  { hue: 50,  chroma: 0.140, bg: "chip-color-2-bg", text: "chip-color-2-text", dot: "chip-color-2-dot", activeBg: "chip-color-2-active-bg", activeText: "chip-color-2-active-text" },
  { hue: 300, chroma: 0.130, bg: "chip-color-3-bg", text: "chip-color-3-text", dot: "chip-color-3-dot", activeBg: "chip-color-3-active-bg", activeText: "chip-color-3-active-text" },
  { hue: 10,  chroma: 0.150, bg: "chip-color-4-bg", text: "chip-color-4-text", dot: "chip-color-4-dot", activeBg: "chip-color-4-active-bg", activeText: "chip-color-4-active-text" },
  { hue: 190, chroma: 0.120, bg: "chip-color-5-bg", text: "chip-color-5-text", dot: "chip-color-5-dot", activeBg: "chip-color-5-active-bg", activeText: "chip-color-5-active-text" },
];

function chipInlineStyles(color: (typeof CHIP_COLORS)[number], isActive: boolean) {
  const accent = colorValue(color.hue, color.chroma, 55);
  const border = colorValue(color.hue, color.chroma * 0.4, 82);
  if (isActive) {
    return { backgroundColor: accent, borderColor: accent, color: "oklch(99% 0.005 240)" };
  }
  return { backgroundColor: "transparent", borderColor: border, color: accent };
}

function dotInlineStyle(color: (typeof CHIP_COLORS)[number]) {
  return { backgroundColor: colorValue(color.hue, color.chroma, 55) };
}

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
            onClick={() => onSelect(isActive ? null : group.bangumi_id)}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
            style={{
              transitionDuration: "var(--duration-fast, 150ms)",
              ...chipInlineStyles(color, isActive),
            }}
          >
            <span
              data-testid="chip-dot"
              className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`}
              style={dotInlineStyle(color)}
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
