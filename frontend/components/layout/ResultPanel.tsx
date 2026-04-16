"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { RuntimeResponse, PilgrimagePoint, SearchResultData } from "../../lib/types";
import { isSearchData } from "../../lib/types";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import { useDict } from "../../lib/i18n-context";
import SelectionBar from "../generative/SelectionBar";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";
import { PhotoCard } from "../generative/PhotoCard";
import { ResultPanelToolbar } from "./ResultPanelToolbar";
import { ResultPanelEmptyState } from "./ResultPanelEmptyState";

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
        <ResultPanelEmptyState />
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
        <ResultPanelToolbar
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
