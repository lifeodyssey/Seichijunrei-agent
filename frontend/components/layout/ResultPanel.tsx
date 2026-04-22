"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { RuntimeResponse, PilgrimagePoint, SearchResultData } from "../../lib/types";
import { isSearchData, isRouteData } from "../../lib/types";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import { useDict } from "../../lib/i18n-context";
import { haversineKm } from "../../lib/geo";
import { useSuggest } from "../../contexts/SuggestContext";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";
import RouteConfirm from "../generative/RouteConfirm";
import { PhotoCard } from "../generative/PhotoCard";
import SpotDetail from "../generative/SpotDetail";
import { ResultPanelToolbar } from "./ResultPanelToolbar";
import type { FilterMode } from "./ResultPanelToolbar";
import { ResultPanelEmptyState } from "./ResultPanelEmptyState";
import { prewarmMapbox } from "../map/prewarm";

// ---------------------------------------------------------------------------
// Map — lazy-loaded with ssr:false (Mapbox GL requires window)
// ---------------------------------------------------------------------------

const LazyMap = dynamic(
  () => import("../map/BaseMap"),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = "grid" | "map";

interface ResultPanelProps {
  activeResponse: RuntimeResponse | null;
  onRouteConfirmed?: (orderedIds: string[], origin: string) => void;
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
// Area helpers — derive region from coordinates
// ---------------------------------------------------------------------------

/** Known areas with center coordinates and radius (km). */
const KNOWN_AREAS: { name: string; lat: number; lng: number; r: number }[] = [
  { name: "宇治", lat: 34.888, lng: 135.802, r: 4 },
  { name: "伏見", lat: 34.930, lng: 135.764, r: 5 },
  { name: "京都市", lat: 34.985, lng: 135.758, r: 12 },
  { name: "大阪", lat: 34.686, lng: 135.520, r: 15 },
  { name: "奈良", lat: 34.685, lng: 135.805, r: 10 },
  { name: "神戸", lat: 34.690, lng: 135.195, r: 12 },
];

function pointArea(p: PilgrimagePoint): string {
  for (const area of KNOWN_AREAS) {
    if (haversineKm(p.latitude, p.longitude, area.lat, area.lng) <= area.r) {
      return area.name;
    }
  }
  return "その他";
}

function buildAreas(points: PilgrimagePoint[]): string[] {
  const areas = new Set<string>();
  for (const p of points) areas.add(pointArea(p));
  return Array.from(areas).sort();
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
  onDetail?: (point: PilgrimagePoint) => void;
}

function GridContent({ points, selectedIds, onToggle, onDetail }: GridContentProps) {
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
            onDetail={onDetail}
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
  onRouteConfirmed,
  defaultOrigin,
  loading,
}: ResultPanelProps) {
  const onSuggest = useSuggest();
  const { selectedIds, toggle, clear } = usePointSelectionContext();
  const [view, setView] = useState<ViewMode>("grid");
  const [filterMode, setFilterMode] = useState<FilterMode>("episode");
  const [activeEpRange, setActiveEpRange] = useState<string | null>(null);
  const [activeArea, setActiveArea] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState(false);
  const [detailPoint, setDetailPoint] = useState<PilgrimagePoint | null>(null);

  // Reset confirm mode and detail view when response changes (e.g. new search triggered).
  // Track prev response identity in state to trigger reset without useEffect + setState
  // or ref access during render.
  const [prevResponse, setPrevResponse] = useState(activeResponse);
  if (prevResponse !== activeResponse) {
    setPrevResponse(activeResponse);
    if (confirmMode) setConfirmMode(false);
    if (detailPoint !== null) setDetailPoint(null);
  }

  // Extract search points from the response (when available).
  const searchPoints = useMemo<PilgrimagePoint[]>(() => {
    if (!activeResponse || !isSearchData(activeResponse.data)) return [];
    return (activeResponse.data as SearchResultData).results.rows;
  }, [activeResponse]);

  // Selected points as full PilgrimagePoint[] objects (for RouteConfirm).
  const selectedPoints = useMemo<PilgrimagePoint[]>(
    () => searchPoints.filter((p) => selectedIds.has(p.id)),
    [searchPoints, selectedIds],
  );

  // Episode range filter chips — only built when episode data exists.
  const epRanges = useMemo(() => buildEpRanges(searchPoints), [searchPoints]);

  // Area filter chips — derived from coordinates.
  const areas = useMemo(() => buildAreas(searchPoints), [searchPoints]);

  // Filtered points based on active filter mode + selection.
  const visiblePoints = useMemo<PilgrimagePoint[]>(() => {
    if (filterMode === "episode") {
      if (activeEpRange === null) return searchPoints;
      return searchPoints.filter(
        (p) => p.episode != null && epRangeLabel(p.episode) === activeEpRange,
      );
    }
    if (activeArea === null) return searchPoints;
    return searchPoints.filter((p) => pointArea(p) === activeArea);
  }, [searchPoints, filterMode, activeEpRange, activeArea]);

  // Old SelectionBar and LayoutControls removed — selection bar is now
  // inside PilgrimageGrid (bottom-fixed), and layout controls are not needed
  // in full-result mode per DESIGN.md.

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!activeResponse && loading) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
        {/* layout controls + old selection bar removed */}
        <LoadingSkeleton />
      </section>
    );
  }

  // ── No active response (empty / welcome state) ────────────────────────────
  if (!activeResponse) {
    return (
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
        {/* layout controls + old selection bar removed */}
        <ResultPanelEmptyState />
      </section>
    );
  }

  // ── Active response with search results ───────────────────────────────────
  if (isSearchData(activeResponse.data)) {
    // Prewarm Mapbox GL when results arrive — shaves ~800ms off first map render
    prewarmMapbox();
    const isEmpty = searchPoints.length === 0;

    // ── Confirm mode: show RouteConfirm instead of grid/map ──────────────
    if (confirmMode) {
      return (
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]"
          style={{ animation: "slide-in-right 0.3s ease-out" }}
        >
          <RouteConfirm
            points={selectedPoints}
            defaultOrigin={defaultOrigin ?? ""}
            onConfirm={(ids, origin) => {
              setConfirmMode(false);
              onRouteConfirmed?.(ids, origin);
            }}
            onBack={() => setConfirmMode(false)}
          />
        </section>
      );
    }

    // ── Detail mode: show SpotDetail for a single point ─────────────────
    if (detailPoint) {
      return (
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]"
          style={{ animation: "slide-in-right 0.3s ease-out" }}
        >
          <SpotDetail
            point={detailPoint}
            onBack={() => setDetailPoint(null)}
            onSelect={(id) => { toggle(id); setDetailPoint(null); }}
            isSelected={selectedIds.has(detailPoint.id)}
            nearbyPoints={searchPoints}
          />
        </section>
      );
    }

    return (
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]"
        style={{ animation: "slide-in-right 0.3s ease-out" }}
      >
        {/* layout controls + old selection bar removed */}

        {/* Toolbar: filter chips + view toggle */}
        <ResultPanelToolbar
          view={view}
          onViewChange={setView}
          filterMode={filterMode}
          onFilterModeChange={setFilterMode}
          epRanges={epRanges}
          activeEpRange={activeEpRange}
          onEpRangeChange={setActiveEpRange}
          areas={areas}
          activeArea={activeArea}
          onAreaChange={setActiveArea}
        />

        {/* Content area */}
        {isEmpty ? (
          <NoResults />
        ) : view === "grid" ? (
          <GridContent
            points={visiblePoints}
            selectedIds={selectedIds}
            onToggle={toggle}
            onDetail={setDetailPoint}
          />
        ) : (
          <div className="relative flex-1 overflow-hidden">
            {/* Map skeleton — shown while Mapbox GL JS initializes */}
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-muted)]" style={{ zIndex: 0 }}>
              <div className="flex flex-col items-center gap-2 text-[var(--color-muted-fg)]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ animation: "breathe 2s ease-in-out infinite" }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="text-xs">地图加载中…</span>
              </div>
            </div>
            <LazyMap points={visiblePoints} selectedIds={selectedIds} onToggle={toggle} />
          </div>
        )}

        {/* Bottom selection bar — visible in both grid and map when items selected */}
        {selectedIds.size > 0 && (
          <div
            className="flex shrink-0 items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-card)] px-6 py-3"
            style={{ animation: "slide-up 0.2s var(--ease-out-expo)" }}
          >
            <span className="text-sm font-medium text-[var(--color-fg)]">
              已选 {selectedIds.size} 个
            </span>
            <button
              type="button"
              onClick={() => setConfirmMode(true)}
              disabled={loading || selectedIds.size < 2}
              className="ml-auto flex h-11 items-center gap-2 rounded-[var(--r-md)] bg-[var(--color-primary)] px-5 text-sm font-semibold text-[var(--color-primary-fg)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              规划路线
            </button>
            <button
              type="button"
              onClick={clear}
              className="text-sm text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
            >
              清除
            </button>
          </div>
        )}
      </section>
    );
  }

  // ── Route results: full-bleed (no padding) for horizontal split layout ────
  if (isRouteData(activeResponse.data)) {
    return (
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]"
        style={{ animation: "slide-in-right 0.3s ease-out" }}
      >
        <div className="flex-1 overflow-hidden">
          <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
        </div>
      </section>
    );
  }

  // ── Other response types: fall through to GenerativeUIRenderer ────────────
  // (QA, greet, etc.) — keep existing GenerativeUI path with padding.
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-bg)]"
      style={{ animation: "slide-in-right 0.3s ease-out" }}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
      </div>
    </section>
  );
}
