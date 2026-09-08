/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDayClock } from "../../../src/features/route-detail/hooks";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDayClock", () => {
  it("starts from the loader's sampled instant", () => {
    vi.setSystemTime(new Date("2026-09-08T12:00:00"));
    const { result } = renderHook(() => useDayClock("2026-09-08T08:00:00"));
    expect(result.current.getTime()).toBe(new Date("2026-09-08T08:00:00").getTime());
  });

  it("rolls over to the next local day past midnight", () => {
    vi.setSystemTime(new Date("2026-09-08T23:59:00"));
    const { result } = renderHook(() => useDayClock("2026-09-08T23:59:00"));
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(result.current.getDate()).toBe(9);
  });

  it("keeps ticking across a second midnight", () => {
    vi.setSystemTime(new Date("2026-09-08T23:59:00"));
    const { result } = renderHook(() => useDayClock("2026-09-08T23:59:00"));
    act(() => { vi.advanceTimersByTime(2 * 60_000); });
    act(() => { vi.advanceTimersByTime(24 * 60 * 60_000); });
    expect(result.current.getDate()).toBe(10);
  });
});
