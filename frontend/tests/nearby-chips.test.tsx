/**
 * NearbyChips unit tests (TDD).
 *
 * AC coverage:
 * - Nearby results with 3 anime show 3 colored chips with correct spot counts -> unit
 * - Tapping a chip filters the map and list to that anime only -> browser (tested via unit here via callback)
 * - Each chip has a distinct colored dot matching map pin color -> unit
 * - Only 1 anime in nearby results — no chips rendered, results shown directly -> unit
 * - Zero nearby results — shows NearbyMap empty state -> unit (tested via NearbyChips returning null)
 * - Chip with 0 points_count is excluded from chip list -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NearbyChips, {
  groupByAnime,
  CHIP_COLORS,
  type AnimeGroup,
} from "@/components/generative/NearbyChips";
import type { PilgrimagePoint } from "@/lib/types";

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
  makePoint("a1", "響け！ユーフォニアム", "bg-001"),
  makePoint("a2", "響け！ユーフォニアム", "bg-001"),
  makePoint("a3", "響け！ユーフォニアム", "bg-001"),
];

const ANIME_B_POINTS: PilgrimagePoint[] = [
  makePoint("b1", "君の名は。", "bg-002"),
  makePoint("b2", "君の名は。", "bg-002"),
];

const ANIME_C_POINTS: PilgrimagePoint[] = [
  makePoint("c1", "ヴァイオレット・エヴァーガーデン", "bg-003"),
];

const THREE_ANIME_POINTS = [
  ...ANIME_A_POINTS,
  ...ANIME_B_POINTS,
  ...ANIME_C_POINTS,
];

// ---------------------------------------------------------------------------
// groupByAnime helper tests
// ---------------------------------------------------------------------------

describe("groupByAnime", () => {
  it("groups points by bangumi_id", () => {
    const groups = groupByAnime(THREE_ANIME_POINTS);
    expect(groups).toHaveLength(3);
  });

  it("returns correct count per anime", () => {
    const groups = groupByAnime(THREE_ANIME_POINTS);
    const animeA = groups.find((g) => g.bangumi_id === "bg-001");
    expect(animeA?.points_count).toBe(3);

    const animeB = groups.find((g) => g.bangumi_id === "bg-002");
    expect(animeB?.points_count).toBe(2);

    const animeC = groups.find((g) => g.bangumi_id === "bg-003");
    expect(animeC?.points_count).toBe(1);
  });

  it("uses title from first point in group", () => {
    const groups = groupByAnime(ANIME_A_POINTS);
    expect(groups[0].title).toBe("響け！ユーフォニアム");
  });

  it("falls back to bangumi_id when title is null", () => {
    const noTitlePoints = [makePoint("x1", "", "bg-999", { title: null })];
    const groups = groupByAnime(noTitlePoints);
    expect(groups[0].title).toBe("bg-999");
  });

  it("excludes groups with 0 points_count", () => {
    // groupByAnime itself can't produce 0-count groups by construction,
    // but the component filters them out — test that an injected group with
    // count 0 is not rendered by the component (tested in component tests below)
    const groups = groupByAnime([]);
    expect(groups).toHaveLength(0);
  });

  it("handles points with null bangumi_id by using empty string key", () => {
    const nullIdPoint = makePoint("n1", "Unknown", "");
    const groups = groupByAnime([nullIdPoint]);
    expect(groups).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// CHIP_COLORS tests
// ---------------------------------------------------------------------------

describe("CHIP_COLORS", () => {
  it("contains at least 5 distinct color entries", () => {
    expect(CHIP_COLORS.length).toBeGreaterThanOrEqual(5);
  });

  it("each entry has bg, text, and dot properties", () => {
    for (const c of CHIP_COLORS) {
      expect(c).toHaveProperty("bg");
      expect(c).toHaveProperty("text");
      expect(c).toHaveProperty("dot");
      expect(c).toHaveProperty("activeBg");
      expect(c).toHaveProperty("activeText");
    }
  });
});

// ---------------------------------------------------------------------------
// NearbyChips component rendering tests
// ---------------------------------------------------------------------------

describe("NearbyChips — 3 anime", () => {
  it("renders 3 chips when results span 3 anime", () => {
    const groups = groupByAnime(THREE_ANIME_POINTS);
    render(
      <NearbyChips groups={groups} activeId={null} onSelect={() => {}} />,
    );
    // Each anime chip button should be present (role=button, not counting "all" chip)
    const chipButtons = screen.getAllByRole("button");
    // 3 anime chips
    expect(chipButtons.length).toBe(3);
  });

  it("each chip displays the correct spot count", () => {
    const groups = groupByAnime(THREE_ANIME_POINTS);
    render(
      <NearbyChips groups={groups} activeId={null} onSelect={() => {}} />,
    );
    // Chip for anime A should show 3 spots
    expect(screen.getByText(/響け！ユーフォニアム/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();

    // Chip for anime B should show 2 spots
    expect(screen.getByText(/君の名は。/)).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();

    // Chip for anime C should show 1 spot
    expect(screen.getByText(/ヴァイオレット・エヴァーガーデン/)).toBeInTheDocument();
    expect(screen.getByText(/1/)).toBeInTheDocument();
  });

  it("each chip has a colored dot span", () => {
    const groups = groupByAnime(THREE_ANIME_POINTS);
    const { container } = render(
      <NearbyChips groups={groups} activeId={null} onSelect={() => {}} />,
    );
    // Each chip renders a dot span with data-testid="chip-dot"
    const dots = container.querySelectorAll("[data-testid='chip-dot']");
    expect(dots.length).toBe(3);
  });

  it("chips have distinct colors assigned via CHIP_COLORS cycle", () => {
    const groups = groupByAnime(THREE_ANIME_POINTS);
    const { container } = render(
      <NearbyChips groups={groups} activeId={null} onSelect={() => {}} />,
    );
    const dots = container.querySelectorAll("[data-testid='chip-dot']");
    const dotColors = Array.from(dots).map((d) => d.className);
    // Each chip should have a different color class
    const uniqueColors = new Set(dotColors);
    expect(uniqueColors.size).toBe(3);
  });
});

describe("NearbyChips — 1 anime (no chips rendered)", () => {
  it("renders null when there is only 1 anime group", () => {
    const groups = groupByAnime(ANIME_A_POINTS);
    const { container } = render(
      <NearbyChips groups={groups} activeId={null} onSelect={() => {}} />,
    );
    // When only 1 anime, component renders nothing (null)
    expect(container.firstChild).toBeNull();
  });
});

describe("NearbyChips — zero nearby results", () => {
  it("renders null when groups array is empty", () => {
    const { container } = render(
      <NearbyChips groups={[]} activeId={null} onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("NearbyChips — 0 points_count exclusion", () => {
  it("does not render a chip for a group with 0 points_count", () => {
    const groups: AnimeGroup[] = [
      { bangumi_id: "bg-001", title: "響け", points_count: 3, color_index: 0 },
      { bangumi_id: "bg-002", title: "ゼロ", points_count: 0, color_index: 1 },
    ];
    render(
      <NearbyChips groups={groups} activeId={null} onSelect={() => {}} />,
    );
    // Only 1 chip should be rendered (the 0-count one is excluded)
    // But since only 1 visible chip, component renders null
    const { container } = render(
      <NearbyChips groups={groups} activeId={null} onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 2 chips when 2 of 3 groups have points_count > 0", () => {
    const groups: AnimeGroup[] = [
      { bangumi_id: "bg-001", title: "響け", points_count: 3, color_index: 0 },
      { bangumi_id: "bg-002", title: "ゼロ", points_count: 0, color_index: 1 },
      { bangumi_id: "bg-003", title: "君の名は", points_count: 2, color_index: 2 },
    ];
    render(
      <NearbyChips groups={groups} activeId={null} onSelect={() => {}} />,
    );
    const chipButtons = screen.getAllByRole("button");
    expect(chipButtons.length).toBe(2);
  });
});

describe("NearbyChips — interaction", () => {
  it("calls onSelect with bangumi_id when a chip is clicked", () => {
    const onSelect = vi.fn();
    const groups = groupByAnime(THREE_ANIME_POINTS);
    render(
      <NearbyChips groups={groups} activeId={null} onSelect={onSelect} />,
    );
    const firstChip = screen.getAllByRole("button")[0];
    fireEvent.click(firstChip);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(expect.any(String));
  });

  it("calls onSelect with null (deactivate) when clicking the active chip", () => {
    const onSelect = vi.fn();
    const groups = groupByAnime(THREE_ANIME_POINTS);
    const activeBangumiId = groups[0].bangumi_id;
    render(
      <NearbyChips
        groups={groups}
        activeId={activeBangumiId}
        onSelect={onSelect}
      />,
    );
    // Click the already-active chip to deactivate
    const activeChip = screen.getAllByRole("button")[0];
    fireEvent.click(activeChip);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("marks the active chip with aria-pressed=true", () => {
    const groups = groupByAnime(THREE_ANIME_POINTS);
    const activeBangumiId = groups[0].bangumi_id;
    render(
      <NearbyChips
        groups={groups}
        activeId={activeBangumiId}
        onSelect={() => {}}
      />,
    );
    const chips = screen.getAllByRole("button");
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    expect(chips[1]).toHaveAttribute("aria-pressed", "false");
    expect(chips[2]).toHaveAttribute("aria-pressed", "false");
  });
});
