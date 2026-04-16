"use client";

import { useDict } from "../../lib/i18n-context";

/**
 * Empty state for the result panel when no search has been made yet.
 * Shows a centered message with gradient background and pulsing dots.
 * Design reference: variant-G-empty-states.html
 */
export function ResultPanelEmptyState() {
  const { grid } = useDict();

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      {/* Radial gradient background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 70% at 50% 50%, oklch(93% 0.025 240 / 0.15), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-4 text-center">
        {/* Icon */}
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: "oklch(90% 0.04 240 / 0.3)" }}
        >
          <span className="text-2xl">🗾</span>
        </div>

        {/* Message */}
        <p
          className="font-[family-name:var(--app-font-display)] text-lg font-semibold text-[var(--color-fg)]"
          style={{ opacity: 0.7 }}
        >
          {grid.empty_hint ?? "聖地を探してみよう"}
        </p>

        <p className="max-w-[240px] text-xs font-light leading-relaxed text-[var(--color-muted-fg)]">
          {grid.empty_subtitle ?? "アニメのタイトルを入力すると、聖地巡礼スポットがここに表示されます"}
        </p>

        {/* Pulsing dots */}
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]"
              style={{
                opacity: 0.4,
                animation: `pulse 1.5s ease-in-out ${i * 0.3}s infinite`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Pulse keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
