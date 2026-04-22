"use client";

import { useMemo } from "react";
import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import { groupByAnime, CHIP_COLORS } from "./NearbyChips";

interface NearbyBubbleProps {
  data: SearchResultData;
  onSuggest?: (text: string) => void;
}

interface AnimeCardProps {
  title: string;
  spotCount: number;
  closestDistance: number;
  colorIndex: number;
  onClick: () => void;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function colorValue(hue: number, chroma: number, lightness: number): string {
  return `oklch(${lightness}% ${chroma} ${hue})`;
}

function AnimeNearbyCard({
  title,
  spotCount,
  closestDistance,
  colorIndex,
  onClick,
}: AnimeCardProps) {
  const color = CHIP_COLORS[colorIndex % CHIP_COLORS.length];
  const dotColor = colorValue(color.hue, color.chroma, 55);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-muted)]"
      style={{ minHeight: 44 }}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-sm text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {title}
        </span>
        <span className="text-xs text-[var(--color-muted-fg)]">
          {spotCount} 个圣地 · 最近 {formatDistance(closestDistance)}
        </span>
      </span>
      <span className="shrink-0 text-sm text-[var(--color-muted-fg)]" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export default function NearbyBubble({ data, onSuggest }: NearbyBubbleProps) {
  const points = data.results.rows;

  const groupsWithDistance = useMemo(() => {
    const groups = groupByAnime(points);
    const pointsByBangumi = new Map<string, PilgrimagePoint[]>();
    for (const point of points) {
      const key = point.bangumi_id ?? "";
      const arr = pointsByBangumi.get(key) ?? [];
      arr.push(point);
      pointsByBangumi.set(key, arr);
    }

    return groups.map((group) => {
      const groupPoints = pointsByBangumi.get(group.bangumi_id) ?? [];
      const closestDistance = groupPoints.reduce((min, p) => {
        const d = p.distance_m ?? Infinity;
        return d < min ? d : min;
      }, Infinity);
      return { ...group, closestDistance: closestDistance === Infinity ? 0 : closestDistance };
    });
  }, [points]);

  const total = points.length;
  const radius = data.results.strategy === "geo" ? "1km" : "1km";

  return (
    <div>
      <p className="text-sm font-light leading-loose text-[var(--color-fg)]">
        附近 {radius} 内找到了 {groupsWithDistance.length} 部动漫的 {total} 个圣地
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {groupsWithDistance.map((group) => (
          <AnimeNearbyCard
            key={group.bangumi_id}
            title={group.title}
            spotCount={group.points_count}
            closestDistance={group.closestDistance}
            colorIndex={group.color_index}
            onClick={() => onSuggest?.(`搜索 ${group.title} 附近的圣地`)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => onSuggest?.("显示所有附近圣地")}
        className="mt-3 text-xs text-[var(--color-primary)] hover:underline"
      >
        查看全部 {total} 个圣地 →
      </button>
    </div>
  );
}
