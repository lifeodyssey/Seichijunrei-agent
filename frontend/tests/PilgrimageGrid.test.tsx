/**
 * PilgrimageGrid missing-data handling unit tests (TDD).
 *
 * AC coverage:
 * - Points with null/empty city display "---" -> unit
 * - Points with null screenshot_url render placeholder background -> unit
 * - Points with episode = 0 or null omit episode badge entirely -> unit
 *   (episode-badge omission is also tested in SourceBadge.test.tsx; here we
 *    verify the card renders at all without crashing and the badge is absent)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { PilgrimagePoint } from "@/lib/types";
import { PointSelectionContext } from "@/contexts/PointSelectionContext";
import PilgrimageGrid from "@/components/generative/PilgrimageGrid";
import defaultDict from "@/lib/dictionaries/ja.json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

vi.mock("@/lib/japanRegions", () => ({
  resolveUnknownName: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_POINT: PilgrimagePoint = {
  id: "pt-base",
  name: "宇治駅",
  name_cn: null,
  episode: 1,
  time_seconds: null,
  screenshot_url: "https://example.com/img.jpg",
  bangumi_id: "bg-001",
  latitude: 34.88,
  longitude: 135.8,
  origin: "京都",
};

function makeGrid(rows: Partial<PilgrimagePoint>[], rowsAlt?: Partial<PilgrimagePoint>[]) {
  const resolvedRows = rows.map((r, i) => ({ ...BASE_POINT, id: `pt-${i}`, ...r }));
  return {
    results: {
      rows: rowsAlt
        ? [...resolvedRows, ...rowsAlt.map((r, i) => ({ ...BASE_POINT, id: `pt-alt-${i}`, ...r }))]
        : resolvedRows,
      row_count: resolvedRows.length,
      strategy: "sql" as const,
      status: "ok" as const,
    },
    message: "ok",
    status: "ok" as const,
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PointSelectionContext.Provider
      value={{ selectedIds: new Set<string>(), toggle: () => {}, clear: () => {} }}
    >
      {children}
    </PointSelectionContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tests: null screenshot_url → placeholder background
// ---------------------------------------------------------------------------

describe("PilgrimageGrid — null screenshot_url", () => {
  it("renders the placeholder element (聖) when screenshot_url is null", () => {
    const data = makeGrid([{ screenshot_url: null }]);
    render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    // Placeholder character rendered when there is no image
    expect(screen.getByText("聖")).toBeInTheDocument();
  });

  it("does not render an <img> element when screenshot_url is null", () => {
    const data = makeGrid([{ screenshot_url: null }]);
    const { container } = render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders placeholder when screenshot_url is an empty string", () => {
    const data = makeGrid([{ screenshot_url: "" }]);
    render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    expect(screen.getByText("聖")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: null/empty city → "---" fallback
// ---------------------------------------------------------------------------

describe("PilgrimageGrid — city display fallback", () => {
  it("displays '---' in the city field when origin is null", () => {
    // We need a point whose name/name_cn are also null/unknown
    // so that the city placeholder is visible; we rely on the card
    // rendering a "city" element produced by PilgrimageGrid's city prop.
    // The current PilgrimageGrid passes `origin` to PilgrimageCard as a
    // new `city` prop. The card should render "---" when city is null/empty.
    const data = makeGrid([{ origin: null, name: "不明", name_cn: null }]);
    render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    expect(screen.getByTestId("city-label")).toHaveTextContent("---");
  });

  it("displays '---' when origin is an empty string", () => {
    const data = makeGrid([{ origin: "", name: "不明", name_cn: null }]);
    render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    expect(screen.getByTestId("city-label")).toHaveTextContent("---");
  });

  it("displays the city name when origin has a value", () => {
    const data = makeGrid([{ origin: "京都", name: "不明", name_cn: null }]);
    render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    expect(screen.getByTestId("city-label")).toHaveTextContent("京都");
  });
});

// ---------------------------------------------------------------------------
// Tests: episode badge omission in card
// ---------------------------------------------------------------------------

describe("PilgrimageGrid — episode badge omission", () => {
  it("does not render episode badge when episode is 0", () => {
    const data = makeGrid([{ episode: 0 }]);
    render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    expect(screen.queryByTestId("episode-badge")).toBeNull();
  });

  it("does not render episode badge when episode is null", () => {
    const data = makeGrid([{ episode: null }]);
    render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    expect(screen.queryByTestId("episode-badge")).toBeNull();
  });

  it("renders episode badge when episode > 0", () => {
    const data = makeGrid([{ episode: 3 }]);
    render(
      <Wrapper>
        <PilgrimageGrid data={data} />
      </Wrapper>,
    );
    // ja: 第3話
    expect(screen.getByTestId("episode-badge")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: component does not crash on fully-null point
// ---------------------------------------------------------------------------

describe("PilgrimageGrid — graceful rendering", () => {
  it("renders without crashing when point has all optional fields null", () => {
    const data = makeGrid([
      {
        name_cn: null,
        episode: null,
        time_seconds: null,
        screenshot_url: null,
        origin: null,
        title: null,
        title_cn: null,
        distance_m: null,
        address: null,
      },
    ]);
    expect(() => {
      render(
        <Wrapper>
          <PilgrimageGrid data={data} />
        </Wrapper>,
      );
    }).not.toThrow();
  });
});
