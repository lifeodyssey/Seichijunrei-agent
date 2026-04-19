"use client";

import { cn } from "@/lib/utils";

type ViewMode = "grid" | "map";

interface ResultPanelToolbarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  epRanges: string[];
  activeEpRange: string | null;
  onEpRangeChange: (range: string | null) => void;
}

function chipClass(active: boolean): string {
  return active
    ? "bg-[var(--color-primary)] text-[var(--color-bg)] border-[var(--color-primary)]"
    : "bg-[var(--color-bg)] text-[var(--color-muted-fg)] border-[var(--color-border)]";
}

export function ResultPanelToolbar({
  view,
  onViewChange,
  epRanges,
  activeEpRange,
  onEpRangeChange,
}: ResultPanelToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-1.5">
      {/* Episode filter chips */}
      {epRanges.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => onEpRangeChange(null)}
            className={cn(
              "shrink-0 rounded-[18px] border px-3 py-1 text-[11px] font-medium transition-all duration-150",
              chipClass(activeEpRange === null)
            )}
          >
            すべて
          </button>
          {epRanges.map((range) => (
            <button
              key={range}
              onClick={() => onEpRangeChange(range)}
              className={cn(
                "shrink-0 rounded-[18px] border px-3 py-1 text-[11px] font-medium transition-all duration-150",
                chipClass(activeEpRange === range)
              )}
            >
              {range}
            </button>
          ))}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Grid / map pill toggle */}
      <div className="flex shrink-0 gap-0.5 rounded-lg bg-[var(--color-card)] p-0.5">
        <button
          onClick={() => onViewChange("grid")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150",
            view === "grid"
              ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-[0_1px_3px_oklch(0%_0_0_/_0.08)]"
              : "bg-transparent text-[var(--color-muted-fg)]"
          )}
        >
          <span>📷</span>
          グリッド
        </button>
        <button
          onClick={() => onViewChange("map")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150",
            view === "map"
              ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-[0_1px_3px_oklch(0%_0_0_/_0.08)]"
              : "bg-transparent text-[var(--color-muted-fg)]"
          )}
        >
          <span>🗺</span>
          マップ
        </button>
      </div>
    </div>
  );
}
