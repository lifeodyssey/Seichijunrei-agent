"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { RuntimeResponse, PilgrimagePoint, SearchResultData } from "../../lib/types";
import { isSearchData } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import SelectionBar from "../generative/SelectionBar";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";

// ---------------------------------------------------------------------------
// Leaflet map — lazy-loaded with ssr:false so Leaflet's window accesses do not
// break the static-export build.
// ---------------------------------------------------------------------------

const LazyLeafletMap = dynamic(
  () => import("./LeafletResultMap"),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "grid" | "map";

interface ResultPanelProps {
  activeResponse: RuntimeResponse | null;
  onSuggest?: (text: string) => void;
  onRouteSelected?: (origin: string) => void;
  defaultOrigin?: string;
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Episode-range helpers
// ---------------------------------------------------------------------------

const EP_RANGE = 4; // episodes per bucket

function epRangeLabel(ep: number): string {
  const start = Math.floor((ep - 1) / EP_RANGE) * EP_RANGE + 1;
  const end = start + EP_RANGE - 1;
  return `EP ${start}-${end}`;
}

function buildEpRanges(points: PilgrimagePoint[]): string[] {
  const ranges = new Set<string>();
  for (const p of points) {
    if (p.episode != null) {
      ranges.add(epRangeLabel(p.episode));
    }
  }
  // Sort ranges numerically by their start episode.
  // Extract the first run of digits (e.g. "EP 5-8" → "5") for comparison.
  return Array.from(ranges).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
    const numB = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
    return numA - numB;
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EpisodeBadge({ episode }: { episode: number | null }) {
  const { grid: t } = useDict();
  if (episode == null) return null;
  return (
    <span
      className="absolute left-2 top-2 rounded-[5px] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
    >
      {t.episode.replace("{ep}", String(episode))}
    </span>
  );
}

interface PhotoCardProps {
  point: PilgrimagePoint;
  selected: boolean;
  onToggle: (id: string) => void;
}

function PhotoCard({ point, selected, onToggle }: PhotoCardProps) {
  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-[10px] bg-[var(--color-card)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ border: `2px solid ${selected ? "var(--color-primary)" : "transparent"}` }}
      onClick={() => onToggle(point.id)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(point.id);
        }
      }}
    >
      {/* Image — 16/10 aspect ratio */}
      <div className="relative overflow-hidden" style={{ aspectRatio: "16/10" }}>
        {point.screenshot_url ? (
          <img
            src={point.screenshot_url}
            alt={point.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="h-full w-full bg-[var(--color-muted)]" />
        )}
        <EpisodeBadge episode={point.episode} />
        {selected && (
          <div className="absolute right-2 top-2 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-bold text-white">
            ✓
          </div>
        )}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="truncate text-[13px] font-medium text-[var(--color-fg)]">
          {point.name}
        </p>
        {point.title && (
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted-fg)]">
            {point.title}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="flex w-full flex-1 flex-col gap-4 p-6">
      {[80, 55, 65].map((w) => (
        <div
          key={w}
          className="h-3 rounded-sm bg-[var(--color-muted)]"
          style={{
            width: `${w}%`,
            animation: "pulse-skeleton 1.6s ease-in-out infinite",
          }}
        />
      ))}
      <div
        className="mt-2 h-32 w-full rounded-sm bg-[var(--color-muted)]"
        style={{ animation: "pulse-skeleton 1.6s ease-in-out infinite 0.2s" }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  onSuggest,
}: {
  onSuggest?: (text: string) => void;
}) {
  const { chat, clarification } = useDict();

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Radial gradient background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 60% 70%, oklch(93% 0.025 240 / 0.18), transparent 70%)",
        }}
      />
      {/* Map watermark */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: "url(/empty-map.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      <div className="relative flex flex-1 flex-col justify-end pb-16 pl-10 pr-8">
        <div className="relative mb-6 select-none leading-[0.85]">
          <div
            className="font-[family-name:var(--app-font-display)] font-bold"
            style={{
              fontSize: "clamp(5rem, 12vw, 9rem)",
              color: "color-mix(in oklch, var(--color-fg) 9%, transparent)",
            }}
          >
            <div>聖地</div>
            <div>巡礼</div>
          </div>
          <div
            className="absolute left-0 top-0 font-[family-name:var(--app-font-display)] font-bold text-[var(--color-primary)]"
            style={{ fontSize: "clamp(5rem, 12vw, 9rem)", lineHeight: "0.85" }}
          >
            聖
          </div>
        </div>

        <div className="mb-5 w-12 border-t border-[var(--color-border)]" />

        <p className="mb-8 max-w-xs text-sm font-light leading-relaxed text-[var(--color-muted-fg)]">
          {chat.welcome_subtitle}
        </p>

        <div className="flex flex-col gap-1.5">
          {clarification.suggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => onSuggest?.(s.query)}
              className="w-fit text-left text-xs font-light text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-primary)]"
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {s.label} →
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar: view toggle + filter chips
// ---------------------------------------------------------------------------

interface ToolbarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  epRanges: string[];
  activeEpRange: string | null;
  onEpRangeChange: (range: string | null) => void;
}

function Toolbar({
  view,
  onViewChange,
  epRanges,
  activeEpRange,
  onEpRangeChange,
}: ToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-white px-4 py-1.5">
      {/* Episode filter chips */}
      {epRanges.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => onEpRangeChange(null)}
            className="shrink-0 rounded-[18px] border px-3 py-1 text-[11px] font-medium transition-all duration-150"
            style={
              activeEpRange === null
                ? {
                    background: "var(--color-primary)",
                    color: "white",
                    borderColor: "var(--color-primary)",
                  }
                : {
                    background: "white",
                    color: "var(--color-muted-fg)",
                    borderColor: "var(--color-border)",
                  }
            }
          >
            すべて
          </button>
          {epRanges.map((range) => (
            <button
              key={range}
              onClick={() => onEpRangeChange(range)}
              className="shrink-0 rounded-[18px] border px-3 py-1 text-[11px] font-medium transition-all duration-150"
              style={
                activeEpRange === range
                  ? {
                      background: "var(--color-primary)",
                      color: "white",
                      borderColor: "var(--color-primary)",
                    }
                  : {
                      background: "white",
                      color: "var(--color-muted-fg)",
                      borderColor: "var(--color-border)",
                    }
              }
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
                  background: "white",
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
                  background: "white",
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

// ---------------------------------------------------------------------------
// No-results state
// ---------------------------------------------------------------------------

function NoResults() {
  const { grid: t } = useDict();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-[13px] text-[var(--color-muted-fg)]">{t.no_results}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid content
// ---------------------------------------------------------------------------

interface GridContentProps {
  points: PilgrimagePoint[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

function GridContent({ points, selectedIds, onToggle }: GridContentProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "12px",
        }}
      >
        {points.map((point) => (
          <PhotoCard
            key={point.id}
            point={point}
            selected={selectedIds.has(point.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResultPanel
// ---------------------------------------------------------------------------

export default function ResultPanel({
  activeResponse,
  onSuggest,
  onRouteSelected,
  defaultOrigin,
  loading,
}: ResultPanelProps) {
  const { selectedIds, toggle, clear } = usePointSelectionContext();
  const [view, setView] = useState<ViewMode>("grid");
  const [activeEpRange, setActiveEpRange] = useState<string | null>(null);

  // Extract search points from the response (when available).
  const searchPoints = useMemo<PilgrimagePoint[]>(() => {
    if (!activeResponse || !isSearchData(activeResponse.data)) return [];
    return (activeResponse.data as SearchResultData).results.rows;
  }, [activeResponse]);

  // Episode range filter chips — only built when episode data exists.
  const epRanges = useMemo(() => buildEpRanges(searchPoints), [searchPoints]);

  // Filtered points based on active episode range.
  const visiblePoints = useMemo<PilgrimagePoint[]>(() => {
    if (activeEpRange === null) return searchPoints;
    return searchPoints.filter(
      (p) => p.episode != null && epRangeLabel(p.episode) === activeEpRange,
    );
  }, [searchPoints, activeEpRange]);

  const selectionBar =
    selectedIds.size > 0 ? (
      <SelectionBar
        count={selectedIds.size}
        defaultOrigin={defaultOrigin ?? ""}
        onRoute={(origin) => onRouteSelected?.(origin)}
        onClear={clear}
        disabled={loading}
      />
    ) : null;

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!activeResponse && loading) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
        {selectionBar}
        <LoadingSkeleton />
      </section>
    );
  }

  // ── No active response (empty / welcome state) ────────────────────────────
  if (!activeResponse) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
        {selectionBar}
        <EmptyState onSuggest={onSuggest} />
      </section>
    );
  }

  // ── Active response with search results ───────────────────────────────────
  if (isSearchData(activeResponse.data)) {
    const isEmpty = searchPoints.length === 0;

    return (
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]"
        style={{ animation: "slide-in-right 0.3s ease-out" }}
      >
        {selectionBar}

        {/* Toolbar: filter chips + view toggle */}
        <Toolbar
          view={view}
          onViewChange={setView}
          epRanges={epRanges}
          activeEpRange={activeEpRange}
          onEpRangeChange={setActiveEpRange}
        />

        {/* Content area */}
        {isEmpty ? (
          <NoResults />
        ) : view === "grid" ? (
          <GridContent
            points={visiblePoints}
            selectedIds={selectedIds}
            onToggle={toggle}
          />
        ) : (
          <div className="relative flex-1 overflow-hidden">
            <LazyLeafletMap points={visiblePoints} selectedIds={selectedIds} onToggle={toggle} />
          </div>
        )}
      </section>
    );
  }

  // ── Other response types: fall through to GenerativeUIRenderer ────────────
  // (route results, QA, greet, etc.) — keep existing GenerativeUI path.
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]"
      style={{ animation: "slide-in-right 0.3s ease-out" }}
    >
      {selectionBar}
      <div className="flex-1 overflow-y-auto p-6">
        <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
      </div>
    </section>
  );
}
