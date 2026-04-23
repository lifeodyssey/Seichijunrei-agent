"use client";

import { useMemo, useState } from "react";
import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { formatDistance } from "../../lib/geo";
import { groupByAnime, CHIP_COLORS } from "./NearbyChips";
import { colorValue } from "../../lib/color";

interface NearbyBubbleProps {
  data: SearchResultData;
  onSuggest?: (text: string) => void;
}

interface AnimeCardProps {
  title: string;
  colorIndex: number;
  imageUrl: string | null;
  spotsDistanceLabel: string;
  onClick: () => void;
}

function AnimeNearbyCard({
  title,
  colorIndex,
  imageUrl,
  spotsDistanceLabel,
  onClick,
}: AnimeCardProps) {
  const [imgError, setImgError] = useState(false);
  const color = CHIP_COLORS[colorIndex % CHIP_COLORS.length];
  const dotColor = colorValue(color.hue, color.chroma, 55);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[var(--r-md)] border border-[var(--color-border)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-muted)]"
      style={{ minHeight: 44 }}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden="true"
      />
      {imageUrl && !imgError ? (
        <img
          src={imageUrl}
          alt=""
          className="h-8 w-10 shrink-0 rounded-[var(--r-sm)] object-cover"
          style={{ background: "var(--color-muted)" }}
          onError={() => setImgError(true)}
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-sm text-[var(--color-fg)]"
          style={{ fontFamily: "var(--app-font-display)" }}
        >
          {title}
        </span>
        <span className="text-xs text-[var(--color-muted-fg)]">
          {spotsDistanceLabel}
        </span>
      </span>
      <span className="shrink-0 text-sm text-[var(--color-muted-fg)]" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export default function NearbyBubble({ data, onSuggest }: NearbyBubbleProps) {
  const { nearby: nt } = useDict();
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
      const firstPoint = groupPoints[0];
      const imageUrl = firstPoint?.screenshot_url ?? null;
      return {
        ...group,
        closestDistance: closestDistance === Infinity ? 0 : closestDistance,
        imageUrl,
      };
    });
  }, [points]);

  const total = points.length;
  const radius = "1km";

  return (
    <div>
      <p className="text-sm font-light leading-loose text-[var(--color-fg)]">
        {nt.summary
          .replace("{radius}", radius)
          .replace("{count}", String(groupsWithDistance.length))
          .replace("{total}", String(total))}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {groupsWithDistance.map((group) => (
          <AnimeNearbyCard
            key={group.bangumi_id}
            title={group.title}
            colorIndex={group.color_index}
            imageUrl={group.imageUrl}
            spotsDistanceLabel={nt.spots_distance
              .replace("{spotCount}", String(group.points_count))
              .replace("{dist}", formatDistance(group.closestDistance))}
            onClick={() => onSuggest?.(nt.search_anime_nearby.replace("{title}", group.title))}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => onSuggest?.(nt.show_all_nearby)}
        className="mt-3 flex w-full items-center gap-3 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-4 transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-muted)]"
        style={{ minHeight: 44 }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[10px] text-[var(--color-primary-fg)]">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </span>
        <span className="flex-1 text-left text-sm text-[var(--color-fg)]">{nt.view_all.replace("{total}", String(total))}</span>
        <span className="text-sm text-[var(--color-muted-fg)]">→</span>
      </button>
    </div>
  );
}
