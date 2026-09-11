/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TURN_TIMEOUT_MS, useTurnTimeout } from "../../../src/features/chat/use-turn-timeout";

afterEach(() => { vi.useRealTimers(); });

it("an active connection survives a long silent turn while transport heartbeat bytes arrive", () => {
  vi.useFakeTimers();
  const stop = vi.fn();
  const view = renderHook(({ activity }) => useTurnTimeout("streaming", stop, activity), { initialProps: { activity: 0 } });
  act(() => { vi.advanceTimersByTime(100_000); });
  view.rerender({ activity: 100_000 });
  act(() => { vi.advanceTimersByTime(100_000); });
  expect(stop).not.toHaveBeenCalled();
  expect(view.result.current.timedOut).toBe(false);
  act(() => { vi.advanceTimersByTime(TURN_TIMEOUT_MS - 100_000); });
  expect(stop).toHaveBeenCalledTimes(1);
});
