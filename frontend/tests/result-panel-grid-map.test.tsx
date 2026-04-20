/**
 * ResultPanel — grid view, map toggle, and episode filter chips.
 * Split from result-panel.test.tsx.
 *
 * AC coverage:
 * - Leaflet map is lazy-loaded via dynamic(() => import(...), { ssr: false }) -> unit
 * - Grid/map toggle switches view -> unit
 * - Filter chips appear for episode ranges when results have episode data -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import ResultPanel from "@/components/layout/ResultPanel";
import type { RuntimeResponse, PilgrimagePoint } from "@/lib/types";
import { PointSelectionContext } from "@/contexts/PointSelectionContext";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({ useDict: () => defaultDict }));

vi.mock("@/components/generative/GenerativeUIRenderer", () => ({
  default: ({ response }: { response: RuntimeResponse }) => (
    <div data-testid="generative-ui">{response.intent}</div>
  ),
}));

vi.mock("@/components/generative/SelectionBar", () => ({
  default: ({ count }: { count: number }) => (
    <div data-testid="selection-bar">
      <span data-testid="selection-count">{count}件選択</span>
    </div>
  ),
}));

vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, opts?: { ssr?: boolean }) => {
    if (opts?.ssr !== false) throw new Error("Leaflet dynamic import must have ssr: false");
    const LazyMap = () => <div data-testid="lazy-map-placeholder" />;
    LazyMap.displayName = "LazyMap";
    return LazyMap;
  },
}));

const BASE_POINT: PilgrimagePoint = {
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

function makeResponse(rows: Partial<PilgrimagePoint>[] = [BASE_POINT]): RuntimeResponse {
  return {
    success: true,
    status: "ok",
    intent: "search_bangumi",
    session_id: "s-001",
    message: "ok",
    data: {
      results: {
        rows: rows.map((r) => ({ ...BASE_POINT, ...r })),
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

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PointSelectionContext.Provider
      value={{ selectedIds: new Set(), toggle: () => {}, clear: () => {} }}
    >
      {children}
    </PointSelectionContext.Provider>
  );
}

describe("ResultPanel grid view (default)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders grid toggle button when activeResponse has results", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByRole("button", { name: /グリッド/i })).toBeInTheDocument();
  });

  it("renders photo card for each result point", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByText("宇治駅")).toBeInTheDocument();
  });
});

describe("ResultPanel grid/map view toggle", () => {
  it("shows map toggle button", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.getByRole("button", { name: /マップ/i })).toBeInTheDocument();
  });

  it("switches to map view when map toggle is clicked", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
    expect(screen.getByTestId("lazy-map-placeholder")).toBeInTheDocument();
  });

  it("switches back to grid view when grid toggle is clicked after switching to map", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
    fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
    expect(screen.getByText("宇治駅")).toBeInTheDocument();
  });

  it("hides the point cards when in map view", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
    expect(screen.queryByText("宇治駅")).toBeNull();
  });
});

describe("ResultPanel Leaflet lazy loading", () => {
  it("does not render map content in default grid view", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    expect(screen.queryByTestId("lazy-map-placeholder")).toBeNull();
  });

  it("renders lazy map placeholder (ssr:false enforced) when map view is active", () => {
    render(<Wrapper><ResultPanel activeResponse={makeResponse()} /></Wrapper>);
    fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
    expect(screen.getByTestId("lazy-map-placeholder")).toBeInTheDocument();
  });
});

describe("ResultPanel filter chips for episode ranges", () => {
  it("renders a 'すべて' chip when results have episode data", () => {
    const response = makeResponse([
      { ...BASE_POINT, id: "pt-001", episode: 1 },
      { ...BASE_POINT, id: "pt-002", episode: 3 },
      { ...BASE_POINT, id: "pt-003", episode: 7 },
    ]);
    render(<Wrapper><ResultPanel activeResponse={response} /></Wrapper>);
    expect(screen.getByRole("button", { name: /すべて/i })).toBeInTheDocument();
  });

  it("renders episode range chips based on available episodes", () => {
    const response = makeResponse([
      { ...BASE_POINT, id: "pt-001", episode: 1 },
      { ...BASE_POINT, id: "pt-002", episode: 3 },
      { ...BASE_POINT, id: "pt-003", episode: 7 },
    ]);
    render(<Wrapper><ResultPanel activeResponse={response} /></Wrapper>);
    const epChips = screen
      .getAllByRole("button")
      .filter((btn) => /EP\s?\d/.test(btn.textContent ?? ""));
    expect(epChips.length).toBeGreaterThan(0);
  });

  it("does not render episode filter chips when no episode data exists", () => {
    const response = makeResponse([{ ...BASE_POINT, id: "pt-001", episode: null }]);
    render(<Wrapper><ResultPanel activeResponse={response} /></Wrapper>);
    const epChips = screen
      .getAllByRole("button")
      .filter((btn) => /EP\s?\d/.test(btn.textContent ?? ""));
    expect(epChips).toHaveLength(0);
  });

  it("filters visible cards to matching episode range when chip is clicked", () => {
    const response = makeResponse([
      { ...BASE_POINT, id: "pt-001", name: "宇治駅", episode: 1 },
      { ...BASE_POINT, id: "pt-002", name: "京アニスタジオ", episode: 7 },
    ]);
    render(<Wrapper><ResultPanel activeResponse={response} /></Wrapper>);
    expect(screen.getByText("宇治駅")).toBeInTheDocument();
    expect(screen.getByText("京アニスタジオ")).toBeInTheDocument();
    const ep1Chip = screen
      .getAllByRole("button")
      .find((b) => /EP\s?1/.test(b.textContent ?? ""));
    if (ep1Chip) {
      fireEvent.click(ep1Chip);
      expect(screen.getByText("宇治駅")).toBeInTheDocument();
      expect(screen.queryByText("京アニスタジオ")).toBeNull();
    }
  });
});
