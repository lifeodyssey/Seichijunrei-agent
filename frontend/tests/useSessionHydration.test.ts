/**
 * Tests for useSessionHydration hook.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockFetchMessages = vi.fn();
const mockHydrateResponseData = vi.fn((data: unknown) => data);

vi.mock("@/lib/api", () => ({
  fetchConversationMessages: (...args: unknown[]) => mockFetchMessages(...args),
  hydrateResponseData: (data: unknown) => mockHydrateResponseData(data),
}));

import { useSessionHydration } from "@/hooks/useSessionHydration";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSessionHydration", () => {
  it("does nothing when sessionId is null", () => {
    const clearSession = vi.fn();
    const appendMessages = vi.fn();

    renderHook(() =>
      useSessionHydration({ sessionId: null, clearSession, appendMessages }),
    );

    expect(mockFetchMessages).not.toHaveBeenCalled();
  });

  it("calls clearSession when messages are empty", async () => {
    mockFetchMessages.mockResolvedValue([]);
    const clearSession = vi.fn();
    const appendMessages = vi.fn();

    renderHook(() =>
      useSessionHydration({ sessionId: "sess-1", clearSession, appendMessages }),
    );

    await vi.waitFor(() => {
      expect(clearSession).toHaveBeenCalled();
    });
  });

  it("clears and appends hydrated messages for non-empty session", async () => {
    mockFetchMessages.mockResolvedValue([
      { role: "user", content: "test", data: null, timestamp: "2026-01-01T00:00:00Z" },
    ]);
    const clearSession = vi.fn();
    const appendMessages = vi.fn();

    renderHook(() =>
      useSessionHydration({ sessionId: "sess-2", clearSession, appendMessages }),
    );

    await vi.waitFor(() => {
      expect(clearSession).toHaveBeenCalled();
      expect(appendMessages).toHaveBeenCalled();
    });
  });

  it("handles fetch errors gracefully", async () => {
    mockFetchMessages.mockRejectedValue(new Error("network"));
    const clearSession = vi.fn();
    const appendMessages = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderHook(() =>
      useSessionHydration({ sessionId: "sess-3", clearSession, appendMessages }),
    );

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    consoleSpy.mockRestore();
  });
});
