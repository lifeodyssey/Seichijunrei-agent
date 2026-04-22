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
      {/* Pulse animation for active dot (single-fire) */}
      <style>{`
        @keyframes dot-pulse {
          0% { box-shadow: 0 0 0 0 oklch(58% 0.19 28 / 0.35); }
          70% { box-shadow: 0 0 0 8px oklch(58% 0.19 28 / 0); }
          100% { box-shadow: 0 0 0 8px oklch(58% 0.19 28 / 0); }
        }
      `}</style>

      {stops.map((stop, idx) => {
        const nextStop = idx < stops.length - 1 ? stops[idx + 1] : null;
        const leg = nextStop ? findLeg(legs, stop, nextStop) : null;
        const isFirst = idx === 0;
        const isLast = idx === stops.length - 1;
        const isActive = stop.cluster_id === activeStopId;
        const photoUrl = stop.points[0]?.screenshot_url ?? null;
        const episode = stop.points[0]?.episode;

        /* Fix 6: active dot sizing */
        const dotSize = isActive ? 14 : isFirst ? 16 : 12;

        return (
          <div key={stop.cluster_id}>
            {/* ── Stop row ── */}
            <button
              type="button"
              className="flex w-full cursor-pointer gap-[14px] rounded-[var(--r-md)] text-left transition-colors duration-150 hover:bg-[var(--color-card)]"
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
                    width: dotSize,
                    height: dotSize,
                    background: isActive
                      ? "var(--color-brand)"
                      : "var(--color-primary)",
                    zIndex: 1,
                    boxShadow: isFirst
                      ? "0 0 0 4px oklch(60% 0.148 240 / 0.15)"
                      : undefined,
                    animation: isActive
                      ? "dot-pulse 0.6s ease-out 1"
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

              {/* Right: content column — Fix 6: stronger active highlight */}
              <div
                className={`min-w-0 flex-1 ${
                  isActive
                    ? "rounded-[var(--r-md)]"
                    : ""
                }`}
                style={
                  isActive
                    ? {
                        padding: 8,
                        margin: "-8px",
                        marginBottom: 2,
                        background: "oklch(94% 0.03 25)",
                      }
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

            {/* ── Walk segment — Fix 5: visually prominent ── */}
            {leg && (
              <div
                className="flex gap-[14px]"
                style={{ padding: "8px 0" }}
              >
                {/* Left: empty 56px spacer */}
                <div className="shrink-0" style={{ width: 56 }} />

                {/* Center: dashed line — wider + more opaque */}
                <div
                  className="flex shrink-0 justify-center"
                  style={{ width: 24 }}
                >
                  <div
                    style={{
                      width: 3,
                      minHeight: 28,
                      background:
                        "repeating-linear-gradient(to bottom, oklch(35% 0.06 145 / 0.7) 0 4px, transparent 4px 8px)",
                    }}
                  />
                </div>

                {/* Walk pill — bolder, more saturated */}
                <div
                  className="inline-flex items-center gap-1 rounded-[var(--r-md)]"
                  style={{
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    background: "oklch(89% 0.04 145)",
                    color: "oklch(30% 0.10 145)",
                  }}
                >
                  <span style={{ fontSize: 15 }}>🚶</span> {leg.duration_minutes} 分 · {fmtDist(leg.distance_m)}
                </div>
              </div>
            )}

            {/* ── Discovery card — shown for walks > 5 min ── */}
            {leg && leg.duration_minutes > 5 && (
              <div className="flex gap-[14px]">
                <div style={{ width: 56 }} className="shrink-0" />
                <div style={{ width: 24 }} className="flex shrink-0 justify-center">
                  <div style={{ width: 3, minHeight: 16, opacity: 0.3, background: "var(--color-border)" }} />
                </div>
                <div
                  className="flex-1 rounded-[var(--r-md)] p-3"
                  style={{ background: "var(--color-walk-bg, oklch(89% 0.04 145))", cursor: "pointer" }}
                >
                  <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-walk-fg, oklch(30% 0.10 145))", marginBottom: 2 }}>
                    📍 附近还有其他动漫圣地
                  </p>
                  <p style={{ fontSize: 12, color: "var(--color-muted-fg)" }}>
                    途中可能会经过其他作品的取景地
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
