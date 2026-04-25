/**
 * useChat — generated_title propagation from SSE done event.
 *
 * AC coverage:
 * - When SSE done event contains generated_title, onTitleUpdate is called -> unit
 * - When generated_title is null, no title update happens -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChat } from "@/hooks/useChat";
import type { RuntimeResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "search_bangumi",
  session_id: "sess-title-test",
  message: "Found spots.",
  data: {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    message: "Found spots.",
    status: "ok",
  },
  session: { interaction_count: 1, route_history_count: 0 },
  route_history: [],
  errors: [],
};

const mockSendMessageStream = vi.fn();

vi.mock("@/lib/api", () => ({
  sendMessageStream: (...args: unknown[]) => mockSendMessageStream(...args),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useChat generated_title", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onTitleUpdate when response contains generated_title", async () => {
    const responseWithTitle: RuntimeResponse = {
      ...BASE_RESPONSE,
      generated_title: "Euphonium pilgrimage spots",
    };
    mockSendMessageStream.mockResolvedValue(responseWithTitle);

    const onSessionId = vi.fn();
    const onTitleUpdate = vi.fn();
    const hook = renderHook(() =>
      useChat("sess-title-test", onSessionId, "ja", onTitleUpdate),
    );

    await act(async () => {
      await hook.result.current.send("ユーフォの聖地");
    });

    expect(onTitleUpdate).toHaveBeenCalledWith(
      "sess-title-test",
      "Euphonium pilgrimage spots",
    );
  });

  it("does not call onTitleUpdate when generated_title is null", async () => {
    const responseWithoutTitle: RuntimeResponse = {
      ...BASE_RESPONSE,
      generated_title: null,
    };
    mockSendMessageStream.mockResolvedValue(responseWithoutTitle);

    const onSessionId = vi.fn();
    const onTitleUpdate = vi.fn();
    const hook = renderHook(() =>
      useChat("sess-title-test", onSessionId, "ja", onTitleUpdate),
    );

    await act(async () => {
      await hook.result.current.send("test");
    });

    expect(onTitleUpdate).not.toHaveBeenCalled();
  });

  it("does not call onTitleUpdate when generated_title is absent", async () => {
    mockSendMessageStream.mockResolvedValue(BASE_RESPONSE);

    const onSessionId = vi.fn();
    const onTitleUpdate = vi.fn();
    const hook = renderHook(() =>
      useChat("sess-title-test", onSessionId, "ja", onTitleUpdate),
    );

    await act(async () => {
      await hook.result.current.send("test");
    });

    expect(onTitleUpdate).not.toHaveBeenCalled();
  });
});
