"use client";

import type { SearchResultData, PilgrimagePoint } from "../../lib/types";
import dynamic from "next/dynamic";
import { useDict } from "../../lib/i18n-context";

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
  const { results } = data;
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

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-xs text-[var(--color-muted-fg)]">
        {t.count.replace("{count}", String(results.row_count))}
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]" style={{ flex: "0 0 60%" }}>
        <PilgrimageMap points={sorted} height="100%" />
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {sorted.map((point: PilgrimagePoint) => (
          <div key={point.id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--color-fg)]">
                {point.name_cn || point.name}
              </p>
              <p className="text-xs text-[var(--color-muted-fg)]">
                {point.title_cn || point.title}
              </p>
            </div>
            {point.distance_m != null && (
              <span className="shrink-0 text-xs font-medium text-[var(--color-primary)]">
                {formatDistance(point.distance_m)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
