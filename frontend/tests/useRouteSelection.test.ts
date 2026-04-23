/**
 * useRouteSelection — route planning from selected points.
 *
 * AC coverage:
 * - executeRouteRequest creates user + placeholder messages -> unit
 * - abort cancels pending request -> unit
 * - handleRouteSelected uses selectedIds -> unit
 * - error handling replaces placeholder with error text -> unit
 * - AbortError removes placeholder -> unit
 * - session ID propagation -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRouteSelection } from "@/hooks/useRouteSelection";
import type { RuntimeResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const ROUTE_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "plan_selected",
  session_id: "route-sess",
  message: "Route planned.",
  data: {
    results: { rows: [], row_count: 0, strategy: "sql" as const, status: "ok" as const },
    route: {
      ordered_points: [],
      point_count: 0,
      status: "ok" as const,
    },
    message: "Route planned.",
    status: "ok" as const,
  },
  session: { interaction_count: 2, route_history_count: 1 },
  route_history: [],
  errors: [],
};

const mockSendSelectedRoute = vi.fn();

const mockBuildSelectedRouteActionText = vi.fn(
  (count: number, origin: string) => `Route ${count} spots from ${origin}`,
);

vi.mock("@/lib/api", () => ({
  sendSelectedRoute: (...args: unknown[]) => mockSendSelectedRoute(...args),
  buildSelectedRouteActionText: (...args: unknown[]) =>
    mockBuildSelectedRouteActionText(...(args as [number, string])),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<Parameters<typeof useRouteSelection>[0]> = {}) {
  return {
    selectedIds: new Set(["pt-1", "pt-2"]),
    sessionId: "sess-1" as string | null,
    locale: "ja" as const,
    isSending: false,
    setSessionId: vi.fn(),
    appendMessages: vi.fn(),
    replaceMessage: vi.fn(),
    removeMessage: vi.fn(),
    clearSelectedPoints: vi.fn(),
    setActiveMessageId: vi.fn(),
    setDrawerOpen: vi.fn(),
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof useRouteSelection>[0]> = {}) {
  const deps = makeDeps(overrides);
  const hook = renderHook(() => useRouteSelection(deps));
  return { hook, deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRouteSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendSelectedRoute.mockResolvedValue(ROUTE_RESPONSE);
  });

  it("handleRouteSelected creates messages and calls sendSelectedRoute", async () => {
    const { hook, deps } = setup();

    await act(async () => {
      await hook.result.current.handleRouteSelected("東京駅");
    });

    // Should clear selection, close drawer, append messages
    expect(deps.clearSelectedPoints).toHaveBeenCalled();
    expect(deps.setActiveMessageId).toHaveBeenCalledWith(null);
    expect(deps.setDrawerOpen).toHaveBeenCalledWith(false);
    expect(deps.appendMessages).toHaveBeenCalledTimes(1);

    // Two messages passed: user + placeholder
    const appendCall = (deps.appendMessages as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(appendCall).toHaveLength(2);
    expect(appendCall[0].role).toBe("user");
    expect(appendCall[1].role).toBe("assistant");
    expect(appendCall[1].loading).toBe(true);

    // sendSelectedRoute called with selectedIds as array
    expect(mockSendSelectedRoute).toHaveBeenCalledWith(
      expect.arrayContaining(["pt-1", "pt-2"]),
      "東京駅",
      "sess-1",
      "ja",
      expect.any(AbortSignal),
    );

    // Placeholder replaced with response
    expect(deps.replaceMessage).toHaveBeenCalledTimes(1);
    const replaceCall = (deps.replaceMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(replaceCall[0]).toBe(appendCall[1].id); // same placeholder id
    // The updater function should produce the response text
    const updatedMsg = replaceCall[1]({ id: "x", role: "assistant" as const, text: "", timestamp: 0 });
    expect(updatedMsg.text).toBe("Route planned.");
    expect(updatedMsg.loading).toBe(false);
  });

  it("propagates session_id from response", async () => {
    const { hook, deps } = setup();

    await act(async () => {
      await hook.result.current.handleRouteSelected("大阪駅");
    });

    expect(deps.setSessionId).toHaveBeenCalledWith("route-sess");
  });

  it("does not call setSessionId when response has no session_id", async () => {
    mockSendSelectedRoute.mockResolvedValueOnce({
      ...ROUTE_RESPONSE,
      session_id: null,
    });

    const { hook, deps } = setup();

    await act(async () => {
      await hook.result.current.handleRouteSelected("京都駅");
    });

    expect(deps.setSessionId).not.toHaveBeenCalled();
  });

  it("does not execute when isSending is true", async () => {
    const { hook } = setup({ isSending: true });

    await act(async () => {
      await hook.result.current.handleRouteSelected("渋谷駅");
    });

    expect(mockSendSelectedRoute).not.toHaveBeenCalled();
  });

  it("does not execute when selectedIds is empty", async () => {
    const { hook } = setup({ selectedIds: new Set<string>() });

    await act(async () => {
      await hook.result.current.handleRouteSelected("新宿駅");
    });

    expect(mockSendSelectedRoute).not.toHaveBeenCalled();
  });

  // -- handleRouteConfirmed -------------------------------------------------

  it("handleRouteConfirmed uses provided orderedIds", async () => {
    const { hook } = setup();

    await act(async () => {
      await hook.result.current.handleRouteConfirmed(["pt-3", "pt-4"], "名古屋駅");
    });

    expect(mockSendSelectedRoute).toHaveBeenCalledWith(
      ["pt-3", "pt-4"],
      "名古屋駅",
      "sess-1",
      "ja",
      expect.any(AbortSignal),
    );
  });

  // -- Error handling -------------------------------------------------------

  it("replaces placeholder with error text on failure", async () => {
    mockSendSelectedRoute.mockRejectedValueOnce(new Error("Network down"));

    const { hook, deps } = setup();

    await act(async () => {
      await hook.result.current.handleRouteSelected("横浜駅");
    });

    expect(deps.replaceMessage).toHaveBeenCalledTimes(1);
    const updater = (deps.replaceMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const msg = updater({ id: "x", role: "assistant" as const, text: "", timestamp: 0 });
    expect(msg.text).toBe("Error: Network down");
    expect(msg.loading).toBe(false);
  });

  it("removes placeholder on AbortError", async () => {
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });
    mockSendSelectedRoute.mockReset();
    mockSendSelectedRoute.mockRejectedValueOnce(abortError);

    const { hook, deps } = setup();

    await act(async () => {
      await hook.result.current.handleRouteSelected("池袋駅");
    });

    expect(deps.removeMessage).toHaveBeenCalledTimes(1);
    // replaceMessage should NOT have been called for AbortError
    expect(deps.replaceMessage).not.toHaveBeenCalled();
  });

  // -- abortRoute -----------------------------------------------------------

  it("abortRoute resets routeSending", async () => {
    // Make the request hang
    let rejectFn!: (err: Error) => void;
    mockSendSelectedRoute.mockImplementationOnce(
      () => new Promise<never>((_resolve, reject) => { rejectFn = reject; }),
    );

    const { hook } = setup();

    // Start route request (won't resolve)
    let routePromise: Promise<void> | undefined;
    act(() => {
      routePromise = hook.result.current.handleRouteSelected("札幌駅");
    });

    // Now abort
    act(() => {
      hook.result.current.abortRoute();
    });

    // The routeSending should be false after abort
    expect(hook.result.current.routeSending).toBe(false);

    // Resolve the pending promise to clean up
    rejectFn(new DOMException("Aborted", "AbortError"));
    await act(async () => {
      try { await routePromise; } catch { /* expected */ }
    });
  });
});
