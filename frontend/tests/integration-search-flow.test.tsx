/**
 * Integration test: Search results flow.
 *
 * Tests the multi-component flow:
 * - ResultPanel renders search response with multiple points
 * - PhotoCard grid renders with clickable cards
 * - Clicking a card toggles selection
 * - Selection count updates in the bottom bar
 * - Clicking "ルートを計画" opens RouteConfirm
 *
 * Mocks: i18n-context, SuggestContext, next/dynamic, map/prewarm
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, useCallback, type ReactNode } from "react";
import ResultPanel from "@/components/layout/ResultPanel";
import type { RuntimeResponse, PilgrimagePoint } from "@/lib/types";
import { PointSelectionContext } from "@/contexts/PointSelectionContext";
import { SuggestContext } from "@/contexts/SuggestContext";
import defaultDict from "@/lib/dictionaries/ja.json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

vi.mock("@/contexts/SuggestContext", async () => {
  const actual = await vi.importActual<typeof import("@/contexts/SuggestContext")>(
    "@/contexts/SuggestContext",
  );
  return {
    ...actual,
    useSuggest: () => vi.fn(),
  };
});

vi.mock("next/dynamic", () => ({
  default: () => {
    const LazyMap = () => <div data-testid="lazy-map-placeholder" />;
    LazyMap.displayName = "LazyMap";
    return LazyMap;
  },
}));

vi.mock("@/components/map/prewarm", () => ({
  prewarmMapbox: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_POINT: PilgrimagePoint = {
  id: "pt-001",
  name: "宇治駅",
  name_cn: "宇治站",
  episode: 1,
  time_seconds: null,
  screenshot_url: "https://example.com/img1.jpg",
  bangumi_id: "bg-001",
  latitude: 34.88,
  longitude: 135.80,
  title: "響け！ユーフォニアム",
  title_cn: "吹响！上低音号",
  origin: "宇治",
};

function makePoint(id: string, overrides: Partial<PilgrimagePoint> = {}): PilgrimagePoint {
  return { ...BASE_POINT, id, ...overrides };
}

const POINTS = [
  makePoint("pt-001", { name: "宇治駅", name_cn: "宇治站" }),
  makePoint("pt-002", { name: "平等院", name_cn: "平等院", episode: 2, latitude: 34.89, longitude: 135.81 }),
  makePoint("pt-003", { name: "伏見稲荷", name_cn: "伏见稻荷", episode: 3, latitude: 34.97, longitude: 135.77 }),
];

function makeSearchResponse(rows: PilgrimagePoint[]): RuntimeResponse {
  return {
    success: true,
    status: "ok",
    intent: "search_bangumi",
    session_id: "s-001",
    message: "ok",
    data: {
      results: {
        rows,
        row_count: rows.length,
        strategy: "sql" as const,
        status: "ok" as const,
      },
      message: "ok",
      status: "ok" as const,
    },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Stateful wrapper — manages real selection state so integration flow works
// ---------------------------------------------------------------------------

function StatefulWrapper({
  children,
}: {
  children: ReactNode;
  onRouteConfirmed?: (ids: string[], origin: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return (
    <SuggestContext.Provider value={{ onSuggest: vi.fn() }}>
      <PointSelectionContext.Provider value={{ selectedIds, toggle, clear }}>
        {children}
      </PointSelectionContext.Provider>
    </SuggestContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: Search results flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders ResultPanel with cards for each point", () => {
    const response = makeSearchResponse(POINTS);
    render(
      <StatefulWrapper>
        <ResultPanel activeResponse={response} />
      </StatefulWrapper>,
    );

    // Each point name should appear in the grid
    expect(screen.getByText("宇治駅")).toBeInTheDocument();
    expect(screen.getByText("平等院")).toBeInTheDocument();
    expect(screen.getByText("伏見稲荷")).toBeInTheDocument();
  });

  it("clicking a card toggles selection and shows selection bar with count", async () => {
    const user = userEvent.setup();
    const response = makeSearchResponse(POINTS);
    render(
      <StatefulWrapper>
        <ResultPanel activeResponse={response} />
      </StatefulWrapper>,
    );

    // No selection bar initially
    expect(screen.queryByText(/選択中/)).not.toBeInTheDocument();

    // Click on the first card (role="button" with aria-pressed)
    const cards = screen.getAllByRole("button", { pressed: false });
    // Find a card that contains our point name
    const card = cards.find((c) => c.textContent?.includes("宇治駅"));
    expect(card).toBeDefined();
    await user.click(card!);

    // Selection bar should now appear with count 1
    expect(screen.getByText(/選択中 1 件/)).toBeInTheDocument();
  });

  it("selecting two cards enables the route plan button", async () => {
    const user = userEvent.setup();
    const response = makeSearchResponse(POINTS);
    render(
      <StatefulWrapper>
        <ResultPanel activeResponse={response} />
      </StatefulWrapper>,
    );

    // Select first card
    const allButtons = screen.getAllByRole("button", { pressed: false });
    const firstCard = allButtons.find((c) => c.textContent?.includes("宇治駅"));
    await user.click(firstCard!);

    // Select second card
    const remainingButtons = screen.getAllByRole("button", { pressed: false });
    const secondCard = remainingButtons.find((c) => c.textContent?.includes("平等院"));
    await user.click(secondCard!);

    // Selection bar should show count 2
    expect(screen.getByText(/選択中 2 件/)).toBeInTheDocument();

    // Route plan button should be enabled
    const routeBtn = screen.getByText("ルートを計画");
    expect(routeBtn.closest("button")).not.toBeDisabled();
  });

  it("clicking ルートを計画 opens RouteConfirm with selected points", async () => {
    const user = userEvent.setup();
    const response = makeSearchResponse(POINTS);
    const onRouteConfirmed = vi.fn();
    render(
      <StatefulWrapper onRouteConfirmed={onRouteConfirmed}>
        <ResultPanel activeResponse={response} onRouteConfirmed={onRouteConfirmed} />
      </StatefulWrapper>,
    );

    // Select first and second cards
    const allButtons = screen.getAllByRole("button", { pressed: false });
    const firstCard = allButtons.find((c) => c.textContent?.includes("宇治駅"));
    await user.click(firstCard!);

    const remainingButtons = screen.getAllByRole("button", { pressed: false });
    const secondCard = remainingButtons.find((c) => c.textContent?.includes("平等院"));
    await user.click(secondCard!);

    // Click "ルートを計画"
    const routeBtn = screen.getByText("ルートを計画");
    await user.click(routeBtn);

    // RouteConfirm should now render — it has the "ルート確認" title
    expect(screen.getByText("ルート確認")).toBeInTheDocument();
    // The two selected points should appear in the confirmation view
    expect(screen.getByText("宇治站")).toBeInTheDocument();
    expect(screen.getByText("平等院")).toBeInTheDocument();
  });

  it("deselecting a card decreases the selection count", async () => {
    const user = userEvent.setup();
    const response = makeSearchResponse(POINTS);
    render(
      <StatefulWrapper>
        <ResultPanel activeResponse={response} />
      </StatefulWrapper>,
    );

    // Select first card
    const allButtons = screen.getAllByRole("button", { pressed: false });
    const firstCard = allButtons.find((c) => c.textContent?.includes("宇治駅"));
    await user.click(firstCard!);
    expect(screen.getByText(/選択中 1 件/)).toBeInTheDocument();

    // Click again to deselect (now it has aria-pressed=true)
    const selectedCards = screen.getAllByRole("button", { pressed: true });
    const selectedCard = selectedCards.find((c) => c.textContent?.includes("宇治駅"));
    await user.click(selectedCard!);

    // Selection bar should disappear
    expect(screen.queryByText(/選択中/)).not.toBeInTheDocument();
  });

  it("route plan button is disabled when only one card is selected", async () => {
    const user = userEvent.setup();
    const response = makeSearchResponse(POINTS);
    render(
      <StatefulWrapper>
        <ResultPanel activeResponse={response} />
      </StatefulWrapper>,
    );

    // Select one card
    const allButtons = screen.getAllByRole("button", { pressed: false });
    const firstCard = allButtons.find((c) => c.textContent?.includes("宇治駅"));
    await user.click(firstCard!);

    // Route plan button should be disabled with only 1 selection
    const routeBtn = screen.getByText("ルートを計画");
    expect(routeBtn.closest("button")).toBeDisabled();
  });
});
