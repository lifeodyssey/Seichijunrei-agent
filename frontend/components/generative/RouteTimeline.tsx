"use client";

import type { TimedItinerary, TimedStop, TransitLeg } from "../../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findLeg(
  legs: TransitLeg[],
  from: TimedStop,
  to: TimedStop,
): TransitLeg | undefined {
  return legs.find(
    (l) => l.from_id === from.cluster_id && l.to_id === to.cluster_id,
  );
}

/** Format distance: <1000 m show meters, otherwise km with 1 decimal. */
function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RouteTimelineProps {
  itinerary: TimedItinerary;
  activeStopId?: string;
  onStopClick?: (stopId: string) => void;
}

// ---------------------------------------------------------------------------
// RouteTimeline
// ---------------------------------------------------------------------------

export default function RouteTimeline({
  itinerary,
  activeStopId,
  onStopClick,
}: RouteTimelineProps) {
  const { stops, legs } = itinerary;

  return (
    <div className="flex flex-col">
      {stops.map((stop, idx) => {
        const nextStop = idx < stops.length - 1 ? stops[idx + 1] : null;
        const leg = nextStop ? findLeg(legs, stop, nextStop) : null;
        const isFirst = idx === 0;
        const isLast = idx === stops.length - 1;
        const isActive = stop.cluster_id === activeStopId;
        const photoUrl = stop.points[0]?.screenshot_url ?? null;
        const episode = stop.points[0]?.episode;

        return (
          <div key={stop.cluster_id}>
            {/* ── Stop row ── */}
            <button
              type="button"
              className="flex w-full gap-[14px] text-left"
              style={{ paddingBottom: 2 }}
              onClick={() => onStopClick?.(stop.cluster_id)}
            >
              {/* Left: time column (56px, right-aligned) */}
              <div
                className="shrink-0 pt-[2px] text-right"
                style={{ width: 56, fontVariantNumeric: "tabular-nums" }}
              >
                <div className="text-sm font-medium text-[var(--color-fg)]">
                  {stop.arrive}
                </div>
                <div className="text-xs text-[var(--color-muted-fg)]">
                  {stop.dwell_minutes} 分
                </div>
              </div>

              {/* Center: dot column (24px) */}
              <div
                className="flex shrink-0 flex-col items-center"
                style={{ width: 24 }}
              >
                <div
                  className="shrink-0 rounded-full"
                  style={{
                    width: isFirst ? 16 : 12,
                    height: isFirst ? 16 : 12,
                    background: isActive
                      ? "var(--color-brand)"
                      : "var(--color-primary)",
                    zIndex: 1,
                    boxShadow: isFirst
                      ? "0 0 0 4px oklch(60% 0.148 240 / 0.15)"
                      : undefined,
                  }}
                />
                {!isLast && (
                  <div
                    className="flex-1 bg-[var(--color-border)]"
                    style={{ width: 2 }}
                  />
                )}
              </div>

              {/* Right: content column */}
              <div
                className={`min-w-0 flex-1 ${
                  isActive
                    ? "rounded-[var(--r-md)] bg-[var(--color-card)]"
                    : ""
                }`}
                style={
                  isActive
                    ? { padding: 8, margin: "-8px", marginBottom: 2 }
                    : { paddingBottom: 6 }
                }
              >
                <div className="mb-0.5 font-[family-name:var(--app-font-display)] text-sm font-semibold text-[var(--color-fg)]">
                  {stop.name}
                </div>
                <div className="mb-1.5 text-xs text-[var(--color-muted-fg)]">
                  {episode != null ? `EP ${episode} · ` : ""}
                  {stop.photo_count} 个圣地
                </div>
                {photoUrl && (
                  <img
                    src={photoUrl}
                    alt={stop.name}
                    width={72}
                    height={48}
                    className="rounded-[var(--r-sm)] bg-[var(--color-muted)] object-cover"
                    style={{ width: 72, height: 48 }}
                    loading="lazy"
                  />
                )}
              </div>
            </button>

            {/* ── Walk segment ── */}
            {leg && (
              <div
                className="flex gap-[14px]"
                style={{ padding: "8px 0" }}
              >
                {/* Left: empty 56px spacer */}
                <div className="shrink-0" style={{ width: 56 }} />

                {/* Center: dashed line */}
                <div
                  className="flex shrink-0 justify-center"
                  style={{ width: 24 }}
                >
                  <div
                    style={{
                      width: 2,
                      minHeight: 28,
                      background:
                        "repeating-linear-gradient(to bottom, oklch(35% 0.06 145 / 0.55) 0 4px, transparent 4px 8px)",
                    }}
                  />
                </div>

                {/* Walk pill */}
                <div
                  className="inline-flex items-center gap-1 rounded-[var(--r-md)] bg-[var(--color-walk-bg)] text-[var(--color-walk-fg)]"
                  style={{
                    padding: "4px 12px",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  🚶 {leg.duration_minutes} 分 · {fmtDist(leg.distance_m)}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
