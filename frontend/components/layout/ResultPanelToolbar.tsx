"use client";

import type { CSSProperties } from "react";

type ViewMode = "grid" | "map";

interface ResultPanelToolbarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  epRanges: string[];
  activeEpRange: string | null;
  onEpRangeChange: (range: string | null) => void;
}

function chipStyle(active: boolean): CSSProperties {
  return active
    ? {
        background: "var(--color-primary)",
        color: "var(--color-bg)",
        borderColor: "var(--color-primary)",
      }
    : {
        background: "var(--color-bg)",
        color: "var(--color-muted-fg)",
        borderColor: "var(--color-border)",
      };
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
            className="shrink-0 rounded-[18px] border px-3 py-1 text-[11px] font-medium transition-all duration-150"
            style={chipStyle(activeEpRange === null)}
          >
            すべて
          </button>
          {epRanges.map((range) => (
            <button
              key={range}
              onClick={() => onEpRangeChange(range)}
              className="shrink-0 rounded-[18px] border px-3 py-1 text-[11px] font-medium transition-all duration-150"
              style={chipStyle(activeEpRange === range)}
            >
              {range}
            </button>
          ))}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Grid / map pill toggle */}
      <div
        className="flex shrink-0 gap-0.5 rounded-lg p-0.5"
        style={{ background: "var(--color-card)" }}
      >
        <button
          onClick={() => onViewChange("grid")}
          className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150"
          style={
            view === "grid"
              ? {
                  background: "var(--color-bg)",
                  color: "var(--color-fg)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                }
              : { background: "transparent", color: "var(--color-muted-fg)" }
          }
        >
          <span>📷</span>
          グリッド
        </button>
        <button
          onClick={() => onViewChange("map")}
          className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-medium transition-all duration-150"
          style={
            view === "map"
              ? {
                  background: "var(--color-bg)",
                  color: "var(--color-fg)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                }
              : { background: "transparent", color: "var(--color-muted-fg)" }
          }
        >
          <span>🗺</span>
          マップ
        </button>
      </div>
    </div>
  );
}
