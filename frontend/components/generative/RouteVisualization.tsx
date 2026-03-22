"use client";

import type { RouteData } from "../../lib/types";
import dynamic from "next/dynamic";

const PilgrimageMap = dynamic(() => import("../map/PilgrimageMap"), { ssr: false });

interface RouteVisualizationProps {
  data: RouteData;
}

export default function RouteVisualization({ data }: RouteVisualizationProps) {
  const { route } = data;
  const points = route.ordered_points;

  if (route.status === "empty" || points.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-fg)]">
        ルートを作成できませんでした。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[var(--color-success)]/15 px-2 py-0.5 text-xs font-medium text-[var(--color-success-fg)]">
          plan_route
        </span>
        <span className="text-xs text-[var(--color-muted-fg)]">
          {route.point_count}スポット
        </span>
        {route.summary?.without_coordinates ? (
          <span className="text-xs text-[var(--color-warning-fg)]">
            ⚠ {route.summary.without_coordinates}件の座標なし
          </span>
        ) : null}
      </div>

      {/* Map + route polyline */}
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        <PilgrimageMap points={points} route={points} height={280} />
      </div>

      {/* Numbered stop list */}
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
                {point.cn_name || point.name}
              </p>
              <p className="text-xs text-[var(--color-muted-fg)]">
                {point.title_cn || point.title} · 第{point.episode}話
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
