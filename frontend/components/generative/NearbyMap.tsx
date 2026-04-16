"use client";

import { useState } from "react";
import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import dynamic from "next/dynamic";
import { useDict } from "../../lib/i18n-context";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import NearbyChips, { groupByAnime } from "./NearbyChips";

const PilgrimageMap = dynamic(() => import("../map/PilgrimageMap"), { ssr: false });

function formatDistance(meters?: number): string {
  if (meters == null) return "";
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

interface NearbyMapProps {
  data: SearchResultData;
}

export default function NearbyMap({ data }: NearbyMapProps) {
  const { map: t } = useDict();
  const { selectedIds, toggle } = usePointSelectionContext();
  const { results } = data;

  const [activeAnimeId, setActiveAnimeId] = useState<string | null>(null);

  const sorted = [...results.rows].sort(
    (a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity),
  );

  if (results.status === "empty" || sorted.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  const animeGroups = groupByAnime(sorted);

  const filtered =
    activeAnimeId != null
      ? sorted.filter((p) => (p.bangumi_id ?? "") === activeAnimeId)
      : sorted;

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-xs text-[var(--color-muted-fg)]">
        {t.count.replace("{count}", String(results.row_count))}
      </p>

      <NearbyChips
        groups={animeGroups}
        activeId={activeAnimeId}
        onSelect={setActiveAnimeId}
      />

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]" style={{ flex: "0 0 60%" }}>
        <PilgrimageMap points={filtered} height="100%" />
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {filtered.map((point: PilgrimagePoint) => (
          <button
            key={point.id}
            type="button"
            onClick={() => toggle(point.id)}
            aria-pressed={selectedIds.has(point.id)}
            className={`flex w-full items-center justify-between px-4 py-3 text-left transition ${
              selectedIds.has(point.id)
                ? "bg-[var(--color-primary)]/10"
                : "hover:bg-[var(--color-muted)]"
            }`}
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${
                  selectedIds.has(point.id)
                    ? "bg-[var(--color-primary)] text-white"
                    : "border border-[var(--color-border)] text-[var(--color-muted-fg)]"
                }`}
              >
                {selectedIds.has(point.id) ? "✓" : "+"}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--color-fg)]">
                  {point.name_cn || point.name}
                </p>
                <p className="text-xs text-[var(--color-muted-fg)]">
                  {point.title_cn || point.title}
                </p>
              </div>
            </div>
            {point.distance_m != null && (
              <span className="shrink-0 text-xs font-medium text-[var(--color-primary)]">
                {formatDistance(point.distance_m)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
