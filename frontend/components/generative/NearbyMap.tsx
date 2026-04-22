"use client";

import { useMemo, useState } from "react";
import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import dynamic from "next/dynamic";
import { useDict } from "../../lib/i18n-context";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import NearbyChips, { groupByAnime } from "./NearbyChips";

const LazyBaseMap = dynamic(() => import("../map/BaseMap"), { ssr: false });

function formatDistance(m?: number | null): string {
  if (m == null) return "";
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

interface NearbyMapProps {
  data: SearchResultData;
}

export default function NearbyMap({ data }: NearbyMapProps) {
  const { map: t } = useDict();
  const { selectedIds, toggle } = usePointSelectionContext();
  const { results } = data;

  const [activeAnimeId, setActiveAnimeId] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...results.rows].sort(
        (a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity),
      ),
    [results.rows],
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
    <div className="flex h-full flex-row gap-0 overflow-hidden rounded-lg border border-[var(--color-border)]">
      {/* Map side — 55% */}
      <div className="relative" style={{ flex: "0 0 55%" }}>
        <LazyBaseMap
          points={filtered}
          height="100%"
          selectedIds={selectedIds}
          onToggle={toggle}
        />
      </div>

      {/* List side — 45% */}
      <div className="flex min-w-0 flex-1 flex-col border-l border-[var(--color-border)]">
        {/* Header + chips */}
        <div className="space-y-2 border-b border-[var(--color-border)] px-4 py-3">
          <p className="text-xs text-[var(--color-muted-fg)]">
            {t.count.replace("{count}", String(results.row_count))}
          </p>
          <NearbyChips
            groups={animeGroups}
            activeId={activeAnimeId}
            onSelect={setActiveAnimeId}
          />
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]">
          {filtered.map((point: PilgrimagePoint) => {
            const isSelected = selectedIds.has(point.id);
            return (
              <button
                key={point.id}
                type="button"
                onClick={() => toggle(point.id)}
                aria-pressed={isSelected}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                  isSelected
                    ? "bg-[var(--color-primary)]/10"
                    : "hover:bg-[var(--color-muted)]"
                }`}
                style={{ transitionDuration: "var(--duration-fast)", minHeight: 44 }}
              >
                {/* Thumbnail */}
                {point.screenshot_url && (
                  <img
                    src={point.screenshot_url}
                    alt=""
                    className="h-9 w-12 shrink-0 rounded object-cover"
                  />
                )}

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium text-[var(--color-fg)]"
                    style={{ fontFamily: "var(--app-font-display)" }}
                  >
                    {point.name_cn || point.name}
                  </p>
                  <p className="truncate text-xs text-[var(--color-muted-fg)]">
                    {point.title_cn || point.title}
                  </p>
                </div>

                {/* Distance badge */}
                {point.distance_m != null && (
                  <span
                    className="shrink-0 text-xs font-medium text-[var(--color-primary)]"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatDistance(point.distance_m)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
