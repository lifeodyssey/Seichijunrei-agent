"use client";

import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import dynamic from "next/dynamic";

const PilgrimageMap = dynamic(() => import("../map/PilgrimageMap"), { ssr: false });

function formatDistance(meters?: number): string {
  if (meters == null) return "";
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

interface NearbyMapProps {
  data: SearchResultData;
}

export default function NearbyMap({ data }: NearbyMapProps) {
  const { results } = data;
  const sorted = [...results.rows].sort(
    (a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity),
  );

  if (results.status === "empty" || sorted.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-fg)]">
        この周辺に聖地が見つかりませんでした。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--color-info)]/15 px-2 py-0.5 text-xs font-medium text-[var(--color-info-fg)]">
          search_by_location
        </span>
        <span className="text-xs text-[var(--color-muted-fg)]">
          {results.row_count}件 · {results.strategy}
        </span>
      </div>

      {/* Map */}
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <PilgrimageMap points={sorted} height={240} />
      </div>

      {/* List */}
      <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {sorted.map((point: PilgrimagePoint) => (
          <div key={point.id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-fg)]">
                {point.cn_name || point.name}
              </p>
              <p className="text-xs text-[var(--color-muted-fg)]">
                {point.title_cn || point.title}
              </p>
            </div>
            {point.distance_m != null && (
              <span className="shrink-0 rounded bg-[var(--color-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--color-fg)]">
                {formatDistance(point.distance_m)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
