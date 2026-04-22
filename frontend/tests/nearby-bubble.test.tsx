/**
 * NearbyBubble unit tests.
 *
 * AC coverage:
 * - Groups points by anime -> unit
 * - Shows colored dot per anime group -> unit
 * - Shows spot count and distance -> unit
 * - Shows "view all" button -> unit
 * - Clicking an anime card calls onSuggest with search query -> unit
 * - Clicking "view all" calls onSuggest with show-all query -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NearbyBubble from "@/components/generative/NearbyBubble";
import type { PilgrimagePoint, SearchResultData } from "@/lib/types";
import zhDict from "@/lib/dictionaries/zh.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => zhDict,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePoint(
  id: string,
  title: string,
  bangumi_id: string,
  overrides: Partial<PilgrimagePoint> = {},
): PilgrimagePoint {
  return {
    id,
    name: `スポット-${id}`,
    name_cn: null,
    episode: null,
    time_seconds: null,
    screenshot_url: null,
    bangumi_id,
    latitude: 35.0,
    longitude: 135.0,
    title,
    title_cn: null,
    distance_m: 100,
    ...overrides,
  };
}

const ANIME_A_POINTS: PilgrimagePoint[] = [
  makePoint("a1", "響け！ユーフォニアム", "bg-001", { distance_m: 50, screenshot_url: "https://example.com/euphonium.jpg" }),
  makePoint("a2", "響け！ユーフォニアム", "bg-001", { distance_m: 200 }),
  makePoint("a3", "響け！ユーフォニアム", "bg-001", { distance_m: 350 }),
];

const ANIME_B_POINTS: PilgrimagePoint[] = [
  makePoint("b1", "君の名は。", "bg-002", { distance_m: 120 }),
  makePoint("b2", "君の名は。", "bg-002", { distance_m: 800 }),
];

const ANIME_C_POINTS: PilgrimagePoint[] = [
  makePoint("c1", "ヴァイオレット・エヴァーガーデン", "bg-003", { distance_m: 1500 }),
];

const ALL_POINTS = [...ANIME_A_POINTS, ...ANIME_B_POINTS, ...ANIME_C_POINTS];

function makeSearchData(points: PilgrimagePoint[]): SearchResultData {
  return {
    results: {
      rows: points,
      row_count: points.length,
      strategy: "geo",
      status: "ok",
    },
    message: "ok",
    status: "ok",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NearbyBubble", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups points by anime and shows one card per anime", () => {
    render(
      <NearbyBubble data={makeSearchData(ALL_POINTS)} />,
    );
    // 3 anime groups
    expect(screen.getByText("響け！ユーフォニアム")).toBeInTheDocument();
    expect(screen.getByText("君の名は。")).toBeInTheDocument();
    expect(screen.getByText("ヴァイオレット・エヴァーガーデン")).toBeInTheDocument();
  });

  it("shows colored dot per anime group", () => {
    const { container } = render(
      <NearbyBubble data={makeSearchData(ALL_POINTS)} />,
    );
    // Each anime card renders a colored dot span with rounded-full
    const dots = container.querySelectorAll("span.rounded-full");
    // At least 3 dots (one per anime group), may include the view-all icon
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });

  it("shows spot count and distance for each anime group", () => {
    render(
      <NearbyBubble data={makeSearchData(ALL_POINTS)} />,
    );
    // Anime A: 3 spots, closest 50m -> "3 个圣地 · 最近 50m"
    expect(screen.getByText(/3 个圣地 · 最近 50m/)).toBeInTheDocument();
    // Anime B: 2 spots, closest 120m -> "2 个圣地 · 最近 120m"
    expect(screen.getByText(/2 个圣地 · 最近 120m/)).toBeInTheDocument();
    // Anime C: 1 spot, closest 1500m -> "1 个圣地 · 最近 1.5km"
    expect(screen.getByText(/1 个圣地 · 最近 1.5km/)).toBeInTheDocument();
  });

  it('shows "view all" button with total count', () => {
    render(
      <NearbyBubble data={makeSearchData(ALL_POINTS)} />,
    );
    const viewAllText = zhDict.nearby.view_all.replace("{total}", String(ALL_POINTS.length));
    expect(screen.getByText(viewAllText)).toBeInTheDocument();
  });

  it("clicking an anime card calls onSuggest with search query", () => {
    const onSuggest = vi.fn();
    render(
      <NearbyBubble data={makeSearchData(ALL_POINTS)} onSuggest={onSuggest} />,
    );
    // Click the first anime card
    fireEvent.click(screen.getByText("響け！ユーフォニアム").closest("button")!);
    expect(onSuggest).toHaveBeenCalledOnce();
    const expectedQuery = zhDict.nearby.search_anime_nearby.replace("{title}", "響け！ユーフォニアム");
    expect(onSuggest).toHaveBeenCalledWith(expectedQuery);
  });

  it('clicking "view all" calls onSuggest with show-all query', () => {
    const onSuggest = vi.fn();
    render(
      <NearbyBubble data={makeSearchData(ALL_POINTS)} onSuggest={onSuggest} />,
    );
    const viewAllText = zhDict.nearby.view_all.replace("{total}", String(ALL_POINTS.length));
    fireEvent.click(screen.getByText(viewAllText).closest("button")!);
    expect(onSuggest).toHaveBeenCalledOnce();
    expect(onSuggest).toHaveBeenCalledWith(zhDict.nearby.show_all_nearby);
  });

  it("shows summary text with anime count and total spots", () => {
    render(
      <NearbyBubble data={makeSearchData(ALL_POINTS)} />,
    );
    // Summary: "附近 1km 内找到了 3 部动漫的 6 个圣地"
    const summaryEl = screen.getByText(/3 部动漫/);
    expect(summaryEl).toBeInTheDocument();
    // "6 个圣地" appears both in summary and view-all button; check the summary <p>
    expect(summaryEl.textContent).toContain("6 个圣地");
  });
});
