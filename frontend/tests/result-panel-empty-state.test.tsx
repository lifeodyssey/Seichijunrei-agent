/**
 * ResultPanel — empty state and zero-results rendering.
 * Split from result-panel.test.tsx.
 *
 * AC coverage:
 * - No active response — result panel shows empty state with hint -> unit
 * - Zero results returned — result panel shows "no results" message -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ResultPanel from "@/components/layout/ResultPanel";
import type { RuntimeResponse } from "@/lib/types";
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

describe("ResultPanel empty state (no active response)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders without crashing when activeResponse is null", () => {
    render(<Wrapper><ResultPanel activeResponse={null} /></Wrapper>);
  });

  it("shows the hint text from the dictionary", () => {
    render(<Wrapper><ResultPanel activeResponse={null} /></Wrapper>);
    expect(screen.getByText(defaultDict.grid.empty_hint)).toBeInTheDocument();
  });

  it("does not show selection bar when no points are selected", () => {
    render(
      <Wrapper selectedIds={new Set<string>()}>
        <ResultPanel activeResponse={null} />
      </Wrapper>,
    );
    expect(screen.queryByTestId("selection-bar")).toBeNull();
  });
});

describe("ResultPanel zero results response", () => {
  it("shows no-results message when result rows are empty", () => {
    const emptyResponse: RuntimeResponse = {
      success: true,
      status: "ok",
      intent: "search_bangumi",
      session_id: "s-001",
      message: "ok",
      data: {
        results: { rows: [], row_count: 0, strategy: "sql", status: "empty" },
        message: "ok",
        status: "empty",
      },
      session: { interaction_count: 1, route_history_count: 0 },
      route_history: [],
      errors: [],
    };
    render(<Wrapper><ResultPanel activeResponse={emptyResponse} /></Wrapper>);
    expect(screen.getByText(defaultDict.grid.no_results)).toBeInTheDocument();
  });
});
