/**
 * SpotDetail unit tests.
 *
 * AC coverage:
 * - Renders spot name in display font -> unit
 * - Shows anime title and episode -> unit
 * - Shows screenshot image -> unit
 * - Shows "select" button (primary when not selected) -> unit
 * - Shows "selected" state (outline when selected) -> unit
 * - Shows nearby points list (up to 5) -> unit
 * - Shows mini map container -> unit
 * - Calls onBack when back clicked -> unit
 * - Calls onSelect when select clicked -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SpotDetail from "@/components/generative/SpotDetail";
import type { PilgrimagePoint } from "@/lib/types";
import zhDict from "@/lib/dictionaries/zh.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => zhDict,
}));

// Mock next/dynamic for BaseMap — Mapbox GL doesn't work in jsdom
vi.mock("next/dynamic", () => ({
  default: () => {
    const MockMap = () => <div data-testid="mini-map" />;
    MockMap.displayName = "MockMap";
    return MockMap;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePoint(
  id: string,
  overrides: Partial<PilgrimagePoint> = {},
): PilgrimagePoint {
  return {
    id,
    name: `スポット-${id}`,
    name_cn: null,
    episode: null,
    time_seconds: null,
    screenshot_url: null,
    bangumi_id: "bg-001",
    latitude: 34.88,
    longitude: 135.8,
    ...overrides,
  };
}

const MAIN_POINT = makePoint("pt-001", {
  name: "宇治橋",
  name_cn: "宇治桥",
  episode: 3,
  time_seconds: 720,
  screenshot_url: "https://example.com/uji-bridge.jpg",
  title: "響け！ユーフォニアム",
  title_cn: "吹响吧！上低音号",
  address: "京都府宇治市宇治",
  latitude: 34.889,
  longitude: 135.808,
});

const NEARBY_POINTS: PilgrimagePoint[] = [
  makePoint("nb-1", { name: "宇治駅", name_cn: "宇治站", latitude: 34.888, longitude: 135.807, distance_m: 120 }),
  makePoint("nb-2", { name: "平等院", name_cn: "平等院", latitude: 34.890, longitude: 135.809, distance_m: 250 }),
  makePoint("nb-3", { name: "大吉山展望台", name_cn: "大吉山展望台", latitude: 34.891, longitude: 135.810, distance_m: 400 }),
  makePoint("nb-4", { name: "宇治神社", name_cn: "宇治神社", latitude: 34.892, longitude: 135.811, distance_m: 550 }),
  makePoint("nb-5", { name: "朝霧橋", name_cn: "朝雾桥", latitude: 34.893, longitude: 135.812, distance_m: 700 }),
  makePoint("nb-6", { name: "中の島", name_cn: "中之岛", latitude: 34.895, longitude: 135.815, distance_m: 1200 }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpotDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders spot name in display font", () => {
    render(
      <SpotDetail point={MAIN_POINT} onBack={vi.fn()} />,
    );
    const heading = screen.getByText("宇治桥");
    expect(heading.tagName).toBe("H2");
    expect(heading.className).toContain("font-display");
  });

  it("shows anime title and episode", () => {
    render(
      <SpotDetail point={MAIN_POINT} onBack={vi.fn()} />,
    );
    // title_cn + episode
    expect(screen.getByText(/吹响吧！上低音号/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it("shows screenshot image with correct src", () => {
    render(
      <SpotDetail point={MAIN_POINT} onBack={vi.fn()} />,
    );
    const img = screen.getByAltText("宇治橋");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("https://example.com/uji-bridge.jpg");
  });

  it("shows placeholder when screenshot_url is null", () => {
    const noScreenshot = makePoint("pt-no-img", { name: "テスト", name_cn: "测试" });
    render(
      <SpotDetail point={noScreenshot} onBack={vi.fn()} />,
    );
    // No img with alt text
    expect(screen.queryByAltText("テスト")).toBeNull();
  });

  it('shows "select" button with primary styling when not selected', () => {
    render(
      <SpotDetail
        point={MAIN_POINT}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={false}
      />,
    );
    const selectBtn = screen.getByText(zhDict.spot_detail.select);
    expect(selectBtn).toBeInTheDocument();
    // Primary button has bg-[var(--color-primary)] in className
    expect(selectBtn.closest("button")?.className).toContain("bg-[var(--color-primary)]");
  });

  it('shows "selected" state with outline styling when selected', () => {
    render(
      <SpotDetail
        point={MAIN_POINT}
        onBack={vi.fn()}
        onSelect={vi.fn()}
        isSelected={true}
      />,
    );
    const selectedBtn = screen.getByText(zhDict.spot_detail.selected);
    expect(selectedBtn).toBeInTheDocument();
    // Outline button has border-[var(--color-primary)] but not bg-[var(--color-primary)]
    const btnClass = selectedBtn.closest("button")?.className ?? "";
    expect(btnClass).toContain("border-[var(--color-primary)]");
    expect(btnClass).not.toContain("bg-[var(--color-primary)]");
  });

  it("shows nearby points list (up to 5)", () => {
    render(
      <SpotDetail
        point={MAIN_POINT}
        onBack={vi.fn()}
        nearbyPoints={NEARBY_POINTS}
      />,
    );
    // nearby_title header
    expect(screen.getByText(zhDict.spot_detail.nearby_title)).toBeInTheDocument();
    // 5 nearest (excluding the 6th)
    expect(screen.getByText("宇治站")).toBeInTheDocument();
    expect(screen.getByText("平等院")).toBeInTheDocument();
    expect(screen.getByText("大吉山展望台")).toBeInTheDocument();
    expect(screen.getByText("宇治神社")).toBeInTheDocument();
    expect(screen.getByText("朝雾桥")).toBeInTheDocument();
    // 6th point should not appear
    expect(screen.queryByText("中之岛")).toBeNull();
  });

  it("shows mini map container", () => {
    render(
      <SpotDetail point={MAIN_POINT} onBack={vi.fn()} />,
    );
    expect(screen.getByTestId("mini-map")).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", () => {
    const onBack = vi.fn();
    render(
      <SpotDetail point={MAIN_POINT} onBack={onBack} />,
    );
    fireEvent.click(screen.getByText(zhDict.spot_detail.back));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("calls onSelect with point id when select is clicked", () => {
    const onSelect = vi.fn();
    render(
      <SpotDetail
        point={MAIN_POINT}
        onBack={vi.fn()}
        onSelect={onSelect}
        isSelected={false}
      />,
    );
    fireEvent.click(screen.getByText(zhDict.spot_detail.select));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("pt-001");
  });
});
