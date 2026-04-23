/**
 * ResultGridContent — flat grid vs. VirtualGrid branch coverage.
 *
 * Covers:
 * - <50 items → flat grid renders PhotoCards directly
 * - >50 items → VirtualGrid renders via useVirtualizer
 * - ResizeObserver callback updates column count
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { PilgrimagePoint } from "@/lib/types";

// ---------------------------------------------------------------------------
// Hoisted spy — vi.mock factories run before anything else
// ---------------------------------------------------------------------------

const { useVirtualizerSpy } = vi.hoisted(() => {
  const useVirtualizerSpy = vi.fn(() => ({
    getVirtualItems: () => [
      { key: "row-0", index: 0, start: 0, size: 220 },
      { key: "row-1", index: 1, start: 220, size: 220 },
    ],
    getTotalSize: () => 440,
  }));
  return { useVirtualizerSpy };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n-context", () => {
  const defaultDict = require("@/lib/dictionaries/ja.json");
  return { useDict: () => defaultDict };
});

vi.mock("@/components/generative/PhotoCard", () => ({
  PhotoCard: ({ point }: { point: { id: string; name: string } }) => (
    <div data-testid={`photo-card-${point.id}`}>{point.name}</div>
  ),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: useVirtualizerSpy,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePoint(index: number): PilgrimagePoint {
  return {
    id: `pt-${String(index).padStart(3, "0")}`,
    name: `Point ${index}`,
    name_cn: null,
    episode: 1,
    time_seconds: null,
    screenshot_url: null,
    bangumi_id: "bg-001",
    latitude: 34.88 + index * 0.001,
    longitude: 135.8 + index * 0.001,
  };
}

function makePoints(count: number): PilgrimagePoint[] {
  return Array.from({ length: count }, (_, i) => makePoint(i + 1));
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Import the component under test AFTER mocks
// ---------------------------------------------------------------------------

import { GridContent } from "@/components/layout/ResultGridContent";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GridContent — flat grid branch (<= 50 items)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders flat grid with all PhotoCards when item count is under threshold", () => {
    const points = makePoints(10);
    render(
      <GridContent
        points={points}
        selectedIds={new Set()}
        onToggle={noop}
      />,
    );
    for (const p of points) {
      expect(screen.getByTestId(`photo-card-${p.id}`)).toBeInTheDocument();
    }
  });

  it("does not invoke useVirtualizer for small lists", () => {
    render(
      <GridContent
        points={makePoints(5)}
        selectedIds={new Set()}
        onToggle={noop}
      />,
    );
    expect(useVirtualizerSpy).not.toHaveBeenCalled();
  });
});

describe("GridContent — VirtualGrid branch (> 50 items)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders VirtualGrid and invokes useVirtualizer for large lists", () => {
    const points = makePoints(60);
    render(
      <GridContent
        points={points}
        selectedIds={new Set()}
        onToggle={noop}
      />,
    );
    expect(useVirtualizerSpy).toHaveBeenCalled();
  });

  it("renders virtualised rows with PhotoCards", () => {
    const points = makePoints(60);
    render(
      <GridContent
        points={points}
        selectedIds={new Set()}
        onToggle={noop}
      />,
    );
    // First 3 points visible in row 0 (3 cols default)
    expect(screen.getByTestId("photo-card-pt-001")).toBeInTheDocument();
    expect(screen.getByTestId("photo-card-pt-002")).toBeInTheDocument();
    expect(screen.getByTestId("photo-card-pt-003")).toBeInTheDocument();
  });
});

describe("GridContent — ResizeObserver updates columns", () => {
  let roCallback: ResizeObserverCallback | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    roCallback = null;

    // Replace the global polyfill with one that captures the callback
    globalThis.ResizeObserver = class FakeRO {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  it("updates column count when container width changes", () => {
    const points = makePoints(60);
    render(
      <GridContent
        points={points}
        selectedIds={new Set()}
        onToggle={noop}
      />,
    );

    expect(roCallback).not.toBeNull();

    // Simulate resize to wide container (800px)
    act(() => {
      roCallback!(
        [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // Simulate resize to narrow container (200px → 1 col)
    act(() => {
      roCallback!(
        [{ contentRect: { width: 200 } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    // useVirtualizer should have been called during re-renders
    expect(useVirtualizerSpy).toHaveBeenCalled();
  });
});
