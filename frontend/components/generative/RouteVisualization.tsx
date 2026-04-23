"use client";

import type { RouteData } from "../../lib/types";
import dynamic from "next/dynamic";
import { useDict } from "../../lib/i18n-context";
import { isSafeUrl } from "../../lib/url";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

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
      <div className="flex h-full items-center justify-center rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  const handleOpenGoogleMaps = () => {
    const url = `https://www.google.com/maps/dir/${points
      .filter((p) => p.latitude && p.longitude)
      .map((p) => `${p.latitude},${p.longitude}`)
      .join("/")}`;
    if (isSafeUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
    else { console.warn("Rejected unsafe URL:", url); }
  };

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)]">
      {/* Map — upper ~60% */}
      <div className="relative h-[60%] shrink-0">
        <PilgrimageMap points={points} route={points} height="100%" />
      </div>

      {/* Route list — lower ~40% */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <div>
            <p className="text-xs text-[var(--color-muted-fg)]">
              {t.spots.replace("{count}", String(route.point_count))}
            </p>
            {route.summary?.without_coordinates ? (
              <p className="text-[10px] text-[var(--color-warning-fg)]">
                {t.no_coords.replace("{count}", String(route.summary.without_coordinates))}
              </p>
            ) : null}
          </div>
          <Button variant="outline" size="xs" onClick={handleOpenGoogleMaps}>
            {t.export_gmaps}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="divide-y divide-[var(--color-border)]">
            {points.map((point, idx) => (
              <div key={point.id} className="flex items-center gap-2.5 px-3 py-2.5">
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    idx === 0
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                      : "bg-[var(--color-muted)] text-[var(--color-fg)]"
                  }`}
                >
                  {idx + 1}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-[var(--color-fg)]">
                    {point.name_cn || point.name}
                  </p>
                  <p className="text-[10px] text-[var(--color-muted-fg)]">
                    {t.episode.replace("{ep}", String(point.episode))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
