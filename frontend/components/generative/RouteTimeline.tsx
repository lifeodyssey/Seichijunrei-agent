"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import type { TimedItinerary, TransitLeg, TimedStop } from "../../lib/types";

function findLeg(
  legs: TransitLeg[],
  from: TimedStop,
  to: TimedStop,
): TransitLeg | undefined {
  return legs.find((l) => l.from_id === from.cluster_id && l.to_id === to.cluster_id);
}

interface RouteTimelineProps {
  itinerary: TimedItinerary;
}

export default function RouteTimeline({ itinerary }: RouteTimelineProps) {
  const { stops, legs, spot_count, total_minutes, total_distance_m } = itinerary;

  return (
    <ScrollArea className="flex-1 px-4">
      <ol className="relative pb-4">
        {stops.map((stop, idx) => {
          const nextStop = idx < stops.length - 1 ? stops[idx + 1] : null;
          const leg = nextStop ? findLeg(legs, stop, nextStop) : null;

          return (
            <li key={stop.cluster_id} className="relative">
              <div className="flex items-start gap-2 py-1.5">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-white">
                  {idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] tabular-nums text-[var(--color-muted-fg)]">
                    {stop.arrive}
                  </span>
                  <p className="truncate text-sm font-medium text-[var(--color-fg)]">
                    {stop.name}
                  </p>
                  <p className="text-[10px] text-[var(--color-muted-fg)]">
                    {stop.photo_count} scenes · 滞在 {stop.dwell_minutes}min
                  </p>
                </div>
              </div>

              {leg && (
                <div className="flex items-start gap-2 py-1">
                  <div className="flex w-6 shrink-0 justify-center">
                    <div className="h-6 w-px bg-[var(--color-border)]" />
                  </div>
                  <span className="rounded bg-[var(--color-muted)] px-2 py-0.5 text-[10px] text-[var(--color-muted-fg)]">
                    🚶 {leg.duration_minutes}min
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="border-t border-[var(--color-border)] pt-3 pb-4">
        <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-fg)] font-[family-name:var(--app-font-display)]">
          サマリー
        </p>
        <dl className="mt-1 space-y-0.5 text-[11px] text-[var(--color-fg)]">
          <div className="flex justify-between">
            <dt>スポット</dt>
            <dd>{spot_count}</dd>
          </div>
          <div className="flex justify-between">
            <dt>所要時間</dt>
            <dd>{total_minutes}min</dd>
          </div>
          <div className="flex justify-between">
            <dt>移動距離</dt>
            <dd>{(total_distance_m / 1000).toFixed(1)} km</dd>
          </div>
        </dl>
      </div>
    </ScrollArea>
  );
}
