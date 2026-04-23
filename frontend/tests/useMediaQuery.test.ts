/**
 * useMediaQuery — viewport media query hook.
 *
 * AC coverage:
 * - Returns false initially in jsdom -> unit
 * - Responds to matchMedia change events -> unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

// ---------------------------------------------------------------------------
// matchMedia mock
// ---------------------------------------------------------------------------

type ChangeCallback = () => void;

function createMockMatchMedia(initialMatches: boolean) {
  let currentMatches = initialMatches;
  const listeners: ChangeCallback[] = [];

  const mql = {
    get matches() {
      return currentMatches;
    },
    addEventListener: (_event: string, cb: ChangeCallback) => {
      listeners.push(cb);
    },
    removeEventListener: (_event: string, cb: ChangeCallback) => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    },
  };

  const setMatches = (next: boolean) => {
    currentMatches = next;
    listeners.forEach((cb) => cb());
  };

  return { mql, setMatches, listeners };
}

describe("useMediaQuery", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns false when query does not match", () => {
    const { mql } = createMockMatchMedia(false);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
  });

  it("returns true when query matches", () => {
    const { mql } = createMockMatchMedia(true);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(true);
  });

  it("responds to matchMedia change events", () => {
    const { mql, setMatches } = createMockMatchMedia(false);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);

    act(() => {
      setMatches(true);
    });

    expect(result.current).toBe(true);
  });

  it("cleans up event listener on unmount", () => {
    const { mql, listeners } = createMockMatchMedia(false);
    window.matchMedia = vi.fn().mockReturnValue(mql);

    const { unmount } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(listeners.length).toBeGreaterThan(0);

    unmount();
    expect(listeners).toHaveLength(0);
  });
});
