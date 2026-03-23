"use client";

import type { RouteData } from "../../lib/types";
import dynamic from "next/dynamic";
import { useDict } from "../../lib/i18n-context";

const PilgrimageMap = dynamic(() => import("../map/PilgrimageMap"), { ssr: false });

interface RouteVisualizationProps {
  data: RouteData;
}

export default function RouteVisualization({ data }: RouteVisualizationProps) {
  const { route: t } = useDict();
  const { route } = data;
  const points = route.ordered_points;

  if (route.status === "empty" || points.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--color-success)]/15 px-2 py-0.5 text-xs font-medium text-[var(--color-success-fg)]">
          plan_route
        </span>
        <span className="text-xs text-[var(--color-muted-fg)]">
          {t.spots.replace("{count}", String(route.point_count))}
        </span>
        {route.summary?.without_coordinates ? (
          <span className="text-xs text-[var(--color-warning-fg)]">
            {t.no_coords.replace("{count}", String(route.summary.without_coordinates))}
          </span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <PilgrimageMap points={points} route={points} height={280} />
      </div>

      <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
        {points.map((point, idx) => (
          <div key={point.id} className="flex items-center gap-3 px-4 py-3">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                idx === 0
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                  : "bg-[var(--color-fg)] text-[var(--color-bg)]"
              }`}
            >
              {idx + 1}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-fg)]">
                {point.name_cn || point.name}
              </p>
              <p className="text-xs text-[var(--color-muted-fg)]">
                {point.title_cn || point.title} · {t.episode.replace("{ep}", String(point.episode))}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
