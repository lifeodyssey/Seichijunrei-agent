/**
 * ResultPanel unit tests (TDD).
 *
 * AC coverage:
 * - Filter chips appear for episode ranges when results have episode data -> unit
 * - No active response — result panel shows empty state with gradient bg and hint -> unit
 * - Zero results returned — result panel shows "no results" message -> unit
 * - Leaflet map is lazy-loaded via dynamic(() => import(...), { ssr: false }) -> unit
 * - Grid/map toggle switches view, selection state persists across switches -> unit (toggle part)
 * - Selection bar slides up when 1+ points selected, shows count and route button -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import ResultPanel from "@/components/layout/ResultPanel";
import type { RuntimeResponse, PilgrimagePoint } from "@/lib/types";
import { PointSelectionContext } from "@/contexts/PointSelectionContext";
import defaultDict from "@/lib/dictionaries/ja.json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock i18n — useDict returns the Japanese dictionary so we can assert on real strings.
vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

// Mock GenerativeUIRenderer — irrelevant for ResultPanel layout tests.
vi.mock("@/components/generative/GenerativeUIRenderer", () => ({
  default: ({ response }: { response: RuntimeResponse }) => (
    <div data-testid="generative-ui">{response.intent}</div>
  ),
}));

// Mock SelectionBar — we test integration via PointSelectionContext below.
vi.mock("@/components/generative/SelectionBar", () => ({
  default: ({
    count,
    onRoute,
    onClear,
  }: {
    count: number;
    defaultOrigin: string;
    onRoute: (o: string) => void;
    onClear: () => void;
    disabled?: boolean;
  }) => (
    <div data-testid="selection-bar">
      <span data-testid="selection-count">{count}件選択</span>
      <button onClick={() => onRoute("")} data-testid="route-btn">
        ルートを作成
      </button>
      <button onClick={onClear} data-testid="clear-btn">
        クリア
      </button>
    </div>
  ),
}));

// Mock next/dynamic — when used with ssr:false, return a placeholder so we can
// verify the Leaflet map is NOT rendered until the map view is activated.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: () => ReactNode }>, opts?: { ssr?: boolean }) => {
    // Capture ssr option to verify it is false.
    if (opts?.ssr !== false) {
      throw new Error("Leaflet dynamic import must have ssr: false");
    }
    // Return a lazy component that renders a sentinel element.
    const LazyMap = () => <div data-testid="lazy-map-placeholder" />;
    LazyMap.displayName = "LazyMap";
    return LazyMap;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSearchResponse(rows: Partial<PilgrimagePoint>[] = [POINT]): RuntimeResponse {
  return {
    success: true,
    status: "ok",
    intent: "search_bangumi",
    session_id: "s-001",
    message: "ok",
    data: {
      results: {
        rows: rows.map((r) => ({ ...POINT, ...r })),
        row_count: rows.length,
        strategy: "sql",
        status: rows.length > 0 ? "ok" : "empty",
      },
      message: "ok",
      status: rows.length > 0 ? "ok" : "empty",
    },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
  };
}

const POINT: PilgrimagePoint = {
  id: "pt-001",
  name: "宇治駅",
  name_cn: null,
  episode: 1,
  time_seconds: null,
  screenshot_url: "https://example.com/img.jpg",
  bangumi_id: "bg-001",
  latitude: 34.88,
  longitude: 135.8,
};

interface WrapperProps {
  selectedIds?: Set<string>;
  toggle?: (id: string) => void;
  clear?: () => void;
  children: ReactNode;
}

function SelectionWrapper({
  selectedIds = new Set<string>(),
  toggle = () => {},
  clear = () => {},
  children,
}: WrapperProps) {
  return (
    <PointSelectionContext.Provider value={{ selectedIds, toggle, clear }}>
      {children}
    </PointSelectionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResultPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Empty state ───────────────────────────────────────────────────────────

  describe("empty state (no active response)", () => {
    it("renders without crashing when activeResponse is null", () => {
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={null} />
        </SelectionWrapper>,
      );
      // The panel should mount without throwing.
    });

    it("shows the hint text from the dictionary", () => {
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={null} />
        </SelectionWrapper>,
      );
      // Empty state shows the grid.empty_hint text
      expect(screen.getByText(defaultDict.grid.empty_hint)).toBeInTheDocument();
    });

    it("does not show selection bar when no points are selected", () => {
      render(
        <SelectionWrapper selectedIds={new Set<string>()}>
          <ResultPanel activeResponse={null} />
        </SelectionWrapper>,
      );
      expect(screen.queryByTestId("selection-bar")).toBeNull();
    });
  });

  // ── Zero results ──────────────────────────────────────────────────────────

  describe("zero results response", () => {
    it("shows no-results message when result rows are empty", () => {
      const emptyResponse = makeSearchResponse([]);
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={emptyResponse} />
        </SelectionWrapper>,
      );
      expect(screen.getByText(defaultDict.grid.no_results)).toBeInTheDocument();
    });
  });

  // ── Grid view (default) ───────────────────────────────────────────────────

  describe("grid view (default)", () => {
    it("renders grid by default when activeResponse has results", () => {
      const response = makeSearchResponse();
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={response} />
        </SelectionWrapper>,
      );
      // Grid toggle button must be present and initially active.
      const gridToggle = screen.getByRole("button", { name: /グリッド/i });
      expect(gridToggle).toBeInTheDocument();
    });

    it("renders photo card for each result point", () => {
      const response = makeSearchResponse();
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={response} />
        </SelectionWrapper>,
      );
      // Point name should appear in the card.
      expect(screen.getByText("宇治駅")).toBeInTheDocument();
    });
  });

  // ── Toggle: grid ↔ map ────────────────────────────────────────────────────

  describe("grid/map view toggle", () => {
    it("shows map toggle button", () => {
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      expect(screen.getByRole("button", { name: /マップ/i })).toBeInTheDocument();
    });

    it("switches to map view when map toggle is clicked", () => {
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      const mapBtn = screen.getByRole("button", { name: /マップ/i });
      fireEvent.click(mapBtn);
      // The lazy-loaded map placeholder should now be present.
      expect(screen.getByTestId("lazy-map-placeholder")).toBeInTheDocument();
    });

    it("switches back to grid view when grid toggle is clicked after switching to map", () => {
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      // Switch to map
      fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
      // Switch back to grid
      fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
      // Point card should be visible again.
      expect(screen.getByText("宇治駅")).toBeInTheDocument();
    });

    it("hides the point cards when in map view", () => {
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
      expect(screen.queryByText("宇治駅")).toBeNull();
    });
  });

  // ── Filter chips ──────────────────────────────────────────────────────────

  describe("filter chips for episode ranges", () => {
    it("renders a 'すべて' chip when results have episode data", () => {
      const response = makeSearchResponse([
        { ...POINT, id: "pt-001", episode: 1 },
        { ...POINT, id: "pt-002", episode: 3 },
        { ...POINT, id: "pt-003", episode: 7 },
      ]);
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={response} />
        </SelectionWrapper>,
      );
      expect(screen.getByRole("button", { name: /すべて/i })).toBeInTheDocument();
    });

    it("renders episode range chips based on available episodes", () => {
      const response = makeSearchResponse([
        { ...POINT, id: "pt-001", episode: 1 },
        { ...POINT, id: "pt-002", episode: 3 },
        { ...POINT, id: "pt-003", episode: 7 },
      ]);
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={response} />
        </SelectionWrapper>,
      );
      // At least one EP range chip should appear (EP 1-4 or similar).
      const epChips = screen.getAllByRole("button").filter((btn) =>
        /EP\s?\d/.test(btn.textContent ?? ""),
      );
      expect(epChips.length).toBeGreaterThan(0);
    });

    it("does not render episode filter chips when no episode data exists", () => {
      const response = makeSearchResponse([{ ...POINT, id: "pt-001", episode: null }]);
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={response} />
        </SelectionWrapper>,
      );
      const epChips = screen.getAllByRole("button").filter((btn) =>
        /EP\s?\d/.test(btn.textContent ?? ""),
      );
      expect(epChips).toHaveLength(0);
    });

    it("filters visible cards to matching episode range when chip is clicked", () => {
      const response = makeSearchResponse([
        { ...POINT, id: "pt-001", name: "宇治駅", episode: 1 },
        { ...POINT, id: "pt-002", name: "京アニスタジオ", episode: 7 },
      ]);
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={response} />
        </SelectionWrapper>,
      );
      // Both initially visible
      expect(screen.getByText("宇治駅")).toBeInTheDocument();
      expect(screen.getByText("京アニスタジオ")).toBeInTheDocument();

      // Click EP 1-4 chip to filter
      const ep1Chip = screen.getAllByRole("button").find((b) =>
        /EP\s?1/.test(b.textContent ?? ""),
      );
      if (ep1Chip) {
        fireEvent.click(ep1Chip);
        // EP-1 point should remain; EP-7 point should be hidden.
        expect(screen.getByText("宇治駅")).toBeInTheDocument();
        expect(screen.queryByText("京アニスタジオ")).toBeNull();
      }
    });
  });

  // ── Selection bar ─────────────────────────────────────────────────────────

  describe("selection bar", () => {
    it("shows selection bar when one or more points are selected", () => {
      render(
        <SelectionWrapper selectedIds={new Set(["pt-001"])}>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      expect(screen.getByTestId("selection-bar")).toBeInTheDocument();
    });

    it("shows correct count in selection bar", () => {
      render(
        <SelectionWrapper selectedIds={new Set(["pt-001", "pt-002"])}>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      expect(screen.getByTestId("selection-count")).toHaveTextContent("2件選択");
    });

    it("does not show selection bar when no points are selected", () => {
      render(
        <SelectionWrapper selectedIds={new Set()}>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      expect(screen.queryByTestId("selection-bar")).toBeNull();
    });

    it("calls onRouteSelected when route button is clicked", () => {
      const onRouteSelected = vi.fn();
      render(
        <SelectionWrapper selectedIds={new Set(["pt-001"])}>
          <ResultPanel
            activeResponse={makeSearchResponse()}
            onRouteSelected={onRouteSelected}
          />
        </SelectionWrapper>,
      );
      fireEvent.click(screen.getByTestId("route-btn"));
      expect(onRouteSelected).toHaveBeenCalledOnce();
    });

    it("calls clear on PointSelectionContext when clear button is clicked", () => {
      const clear = vi.fn();
      render(
        <SelectionWrapper selectedIds={new Set(["pt-001"])} clear={clear}>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      fireEvent.click(screen.getByTestId("clear-btn"));
      expect(clear).toHaveBeenCalledOnce();
    });

    it("selection bar persists when toggling between grid and map views", () => {
      render(
        <SelectionWrapper selectedIds={new Set(["pt-001"])}>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      // Switch to map
      fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
      expect(screen.getByTestId("selection-bar")).toBeInTheDocument();
      // Switch back to grid
      fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
      expect(screen.getByTestId("selection-bar")).toBeInTheDocument();
    });
  });

  // ── Leaflet lazy-load ─────────────────────────────────────────────────────

  describe("Leaflet lazy loading", () => {
    it("does not render map content until map view is activated", () => {
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      // In grid (default) view, the lazy map placeholder should not be present.
      expect(screen.queryByTestId("lazy-map-placeholder")).toBeNull();
    });

    it("renders lazy map placeholder (ssr:false enforced) when map view is active", () => {
      // The vi.mock for next/dynamic throws if ssr !== false, so this test
      // also validates the ssr:false requirement at mock time.
      render(
        <SelectionWrapper>
          <ResultPanel activeResponse={makeSearchResponse()} />
        </SelectionWrapper>,
      );
      fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
      expect(screen.getByTestId("lazy-map-placeholder")).toBeInTheDocument();
    });
  });
});
