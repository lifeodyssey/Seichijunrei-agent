/**
 * ResultPanel — selection bar state and interactions.
 * Split from result-panel.test.tsx.
 *
 * AC coverage:
 * - Selection bar slides up when 1+ points selected, shows count and route button -> unit
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
      <button onClick={() => onRoute("")} data-testid="route-btn">ルートを作成</button>
      <button onClick={onClear} data-testid="clear-btn">クリア</button>
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
        status: "ok",
      },
      message: "ok",
      status: "ok",
    },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
  };
}

function Wrapper({
  selectedIds = new Set<string>(),
  toggle = () => {},
  clear = () => {},
  children,
}: {
  selectedIds?: Set<string>;
  toggle?: (id: string) => void;
  clear?: () => void;
  children: ReactNode;
}) {
  return (
    <PointSelectionContext.Provider value={{ selectedIds, toggle, clear }}>
      {children}
    </PointSelectionContext.Provider>
  );
}

describe("ResultPanel selection bar", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("shows selection bar when one or more points are selected", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001"])}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    expect(screen.getByTestId("selection-bar")).toBeInTheDocument();
  });

  it("shows correct count in selection bar", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001", "pt-002"])}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    expect(screen.getByTestId("selection-count")).toHaveTextContent("2件選択");
  });

  it("does not show selection bar when no points are selected", () => {
    render(
      <Wrapper selectedIds={new Set()}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    expect(screen.queryByTestId("selection-bar")).toBeNull();
  });

  it("calls onRouteSelected when route button is clicked", () => {
    const onRouteSelected = vi.fn();
    render(
      <Wrapper selectedIds={new Set(["pt-001"])}>
        <ResultPanel activeResponse={makeResponse()} onRouteSelected={onRouteSelected} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("route-btn"));
    expect(onRouteSelected).toHaveBeenCalledOnce();
  });

  it("calls clear on PointSelectionContext when clear button is clicked", () => {
    const clear = vi.fn();
    render(
      <Wrapper selectedIds={new Set(["pt-001"])} clear={clear}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId("clear-btn"));
    expect(clear).toHaveBeenCalledOnce();
  });

  it("selection bar persists when toggling between grid and map views", () => {
    render(
      <Wrapper selectedIds={new Set(["pt-001"])}>
        <ResultPanel activeResponse={makeResponse()} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: /マップ/i }));
    expect(screen.getByTestId("selection-bar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /グリッド/i }));
    expect(screen.getByTestId("selection-bar")).toBeInTheDocument();
  });
});
