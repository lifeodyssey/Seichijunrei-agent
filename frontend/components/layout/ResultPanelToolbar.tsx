"use client";

import { cn } from "@/lib/utils";
import { useDict } from "../../lib/i18n-context";

export type ViewMode = "grid" | "map";
export type FilterMode = "episode" | "area";

interface ResultPanelToolbarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  filterMode: FilterMode;
  onFilterModeChange: (m: FilterMode) => void;
  /** Episode range chips (e.g. "EP 1-4", "EP 5-8") */
  epRanges: string[];
  activeEpRange: string | null;
  onEpRangeChange: (range: string | null) => void;
  /** Area chips (e.g. "宇治", "京都") */
  areas: string[];
  activeArea: string | null;
  onAreaChange: (area: string | null) => void;
}

function chipClass(active: boolean): string {
  return active
    ? "bg-[var(--color-primary)] text-[var(--color-bg)] border-[var(--color-primary)]"
    : "bg-[var(--color-bg)] text-[var(--color-muted-fg)] border-[var(--color-border)]";
}

function tabClass(active: boolean): string {
  return active
    ? "text-[var(--color-fg)] border-b-2 border-[var(--color-primary)]"
    : "text-[var(--color-muted-fg)] border-b-2 border-transparent";
}

export function ResultPanelToolbar({
  view,
  onViewChange,
  filterMode,
  onFilterModeChange,
  epRanges,
  activeEpRange,
  onEpRangeChange,
  areas,
  activeArea,
  onAreaChange,
}: ResultPanelToolbarProps) {
  const { toolbar: t } = useDict();
  const chips = filterMode === "episode" ? epRanges : areas;
  const activeChip = filterMode === "episode" ? activeEpRange : activeArea;
  const onChipChange = filterMode === "episode" ? onEpRangeChange : onAreaChange;

  return (
    <div className="flex shrink-0 flex-col border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Tab row: 按集数 | 按地区 + view toggle */}
      <div className="flex items-center gap-0 px-4 pt-1">
        <button
          type="button"
          onClick={() => onFilterModeChange("episode")}
          className={cn(
            "px-3 py-2.5 text-[12px] font-medium transition-colors",
            tabClass(filterMode === "episode"),
          )}
        >
          {t.tab_episode}
        </button>
        <button
          type="button"
          onClick={() => onFilterModeChange("area")}
          className={cn(
            "px-3 py-2.5 text-[12px] font-medium transition-colors",
            tabClass(filterMode === "area"),
          )}
        >
          {t.tab_area}
        </button>

        <div className="flex-1" />

        {/* Grid / map pill toggle */}
        <div className="flex shrink-0 gap-0.5 rounded-[var(--r-lg)] bg-[var(--color-card)] p-0.5">
          <button
            type="button"
            onClick={() => onViewChange("grid")}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--r-md)] px-3.5 py-2.5 text-[12px] font-medium transition-all duration-150",
              view === "grid"
                ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-[0_1px_3px_oklch(0%_0_0_/_0.08)]"
                : "bg-transparent text-[var(--color-muted-fg)]",
            )}
          >
            <span>📷</span>
            {t.grid}
          </button>
          <button
            type="button"
            onClick={() => onViewChange("map")}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--r-md)] px-3.5 py-2.5 text-[12px] font-medium transition-all duration-150",
              view === "map"
                ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-[0_1px_3px_oklch(0%_0_0_/_0.08)]"
                : "bg-transparent text-[var(--color-muted-fg)]",
            )}
          >
            <span>🗺</span>
            {t.map}
          </button>
        </div>
      </div>

      {/* Filter chips row */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-4 py-1.5">
          <button
            type="button"
            onClick={() => onChipChange(null)}
            className={cn(
              "shrink-0 rounded-[18px] border px-3 py-1 text-[11px] font-medium transition-all duration-150",
              chipClass(activeChip === null),
            )}
          >
            {t.all}
          </button>
          {chips.map((chip) => (
            <button
              type="button"
              key={chip}
              onClick={() => onChipChange(chip)}
              className={cn(
                "shrink-0 rounded-[18px] border px-3 py-1 text-[11px] font-medium transition-all duration-150",
                chipClass(activeChip === chip),
              )}
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
