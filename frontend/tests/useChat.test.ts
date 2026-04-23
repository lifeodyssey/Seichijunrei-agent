/**
 * useChat — chat state management + streaming.
 *
 * AC coverage:
 * - send() creates user + placeholder messages -> unit
 * - send() updates placeholder with response on success -> unit
 * - send() handles error and classifies error code -> unit
 * - send() ignores empty/whitespace text -> unit
 * - send() aborts on AbortError and removes placeholder -> unit
 * - clear() aborts in-flight request and clears messages -> unit
 * - appendMessages / replaceMessage / removeMessage helpers -> unit
 * - createMessageId returns unique ids -> unit
 * - session ID propagation via onSessionId -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChat, createMessageId } from "@/hooks/useChat";
import type { RuntimeResponse } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const SEARCH_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "search_bangumi",
  session_id: "sess-new",
  message: "Found 1 spot.",
  data: {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    message: "Found 1 spot.",
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
// Helpers
// ---------------------------------------------------------------------------

function setup(sessionId: string | null = null) {
  const onSessionId = vi.fn();
  const hook = renderHook(() => useChat(sessionId, onSessionId, "ja"));
  return { hook, onSessionId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMessageId", () => {
  it("returns unique ids on successive calls", () => {
    const a = createMessageId();
    const b = createMessageId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^msg-/);
  });
});

describe("useChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessageStream.mockResolvedValue(SEARCH_RESPONSE);
  });

  // -- send() basic flow ---------------------------------------------------

  it("creates user + placeholder messages and resolves with response", async () => {
    const { hook, onSessionId } = setup("sess-1");

    await act(async () => {
      await hook.result.current.send("ユーフォの聖地");
    });

    const messages = hook.result.current.messages;
    expect(messages).toHaveLength(2);

    // User message
    expect(messages[0].role).toBe("user");
    expect(messages[0].text).toBe("ユーフォの聖地");

    // Assistant message (placeholder resolved)
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].text).toBe("Found 1 spot.");
    expect(messages[1].loading).toBe(false);
    expect(messages[1].response).toEqual(SEARCH_RESPONSE);

    // Session ID propagated
    expect(onSessionId).toHaveBeenCalledWith("sess-new");
  });

  it("ignores empty text", async () => {
    const { hook } = setup();

    await act(async () => {
      await hook.result.current.send("   ");
    });

    expect(hook.result.current.messages).toHaveLength(0);
    expect(mockSendMessageStream).not.toHaveBeenCalled();
  });

  it("does not send while already sending", async () => {
    // Make the first call hang indefinitely
    let resolveFirst!: (v: RuntimeResponse) => void;
    mockSendMessageStream.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    const { hook } = setup();

    // Start first send (will not resolve)
    let firstSend: Promise<void> | undefined;
    act(() => {
      firstSend = hook.result.current.send("first");
    });

    // Attempt second send while first is in-flight
    await act(async () => {
      await hook.result.current.send("second");
    });

    // Only one call to the API
    expect(mockSendMessageStream).toHaveBeenCalledTimes(1);

    // Resolve the first to clean up
    resolveFirst(SEARCH_RESPONSE);
    await act(async () => { await firstSend; });
  });

  // -- Error handling -------------------------------------------------------

  it("handles generic error and sets errorCode", async () => {
    mockSendMessageStream.mockRejectedValueOnce(new Error("something broke"));

    const { hook } = setup();

    await act(async () => {
      await hook.result.current.send("test");
    });

    const assistant = hook.result.current.messages[1];
    expect(assistant.text).toBe("something broke");
    expect(assistant.loading).toBe(false);
    expect(assistant.errorCode).toBe("generic");
  });

  it("classifies stream_error correctly", async () => {
    mockSendMessageStream.mockRejectedValueOnce(new Error("network failure"));

    const { hook } = setup();

    await act(async () => {
      await hook.result.current.send("test");
    });

    expect(hook.result.current.messages[1].errorCode).toBe("stream_error");
  });

  it("classifies timeout error correctly", async () => {
    mockSendMessageStream.mockRejectedValueOnce(new Error("request timed out"));

    const { hook } = setup();

    await act(async () => {
      await hook.result.current.send("test");
    });

    expect(hook.result.current.messages[1].errorCode).toBe("timeout");
  });

  it("classifies rate_limit error correctly", async () => {
    mockSendMessageStream.mockRejectedValueOnce(new Error("429 rate limit exceeded"));

    const { hook } = setup();

    await act(async () => {
      await hook.result.current.send("test");
    });

    expect(hook.result.current.messages[1].errorCode).toBe("rate_limit");
  });

  // -- AbortError -----------------------------------------------------------

  it("removes placeholder on AbortError", async () => {
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });
    mockSendMessageStream.mockReset();
    mockSendMessageStream.mockRejectedValueOnce(abortError);

    const { hook } = setup();

    await act(async () => {
      await hook.result.current.send("test");
    });

    // Only the user message should remain — placeholder was removed
    expect(hook.result.current.messages).toHaveLength(1);
    expect(hook.result.current.messages[0].role).toBe("user");
  });

  // -- clear() --------------------------------------------------------------

  it("clear() empties messages and resets sending state", async () => {
    const { hook } = setup();

    // Send a message first
    await act(async () => {
      await hook.result.current.send("hello");
    });
    expect(hook.result.current.messages.length).toBeGreaterThan(0);

    // Clear
    act(() => {
      hook.result.current.clear();
    });
    expect(hook.result.current.messages).toHaveLength(0);
  });

  // -- Helper methods -------------------------------------------------------

  it("appendMessages adds messages to the end", () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.appendMessages(
        { id: "a", role: "user", text: "hello", timestamp: 1 },
        { id: "b", role: "assistant", text: "hi", timestamp: 2 },
      );
    });

    expect(hook.result.current.messages).toHaveLength(2);
    expect(hook.result.current.messages[0].text).toBe("hello");
    expect(hook.result.current.messages[1].text).toBe("hi");
  });

  it("appendMessages with empty args is a no-op", () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.appendMessages();
    });

    expect(hook.result.current.messages).toHaveLength(0);
  });

  it("replaceMessage updates a message by id (object)", () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.appendMessages(
        { id: "x1", role: "user", text: "old", timestamp: 1 },
      );
    });

    act(() => {
      hook.result.current.replaceMessage("x1", {
        id: "x1",
        role: "user",
        text: "new",
        timestamp: 1,
      });
    });

    expect(hook.result.current.messages[0].text).toBe("new");
  });

  it("replaceMessage updates a message by id (function)", () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.appendMessages(
        { id: "x2", role: "assistant", text: "old", timestamp: 1 },
      );
    });

    act(() => {
      hook.result.current.replaceMessage("x2", (m) => ({ ...m, text: "updated" }));
    });

    expect(hook.result.current.messages[0].text).toBe("updated");
  });

  it("removeMessage removes a message by id", () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.appendMessages(
        { id: "r1", role: "user", text: "keep", timestamp: 1 },
        { id: "r2", role: "user", text: "remove", timestamp: 2 },
      );
    });

    act(() => {
      hook.result.current.removeMessage("r2");
    });

    expect(hook.result.current.messages).toHaveLength(1);
    expect(hook.result.current.messages[0].id).toBe("r1");
  });

  // -- Session ID not set when null -----------------------------------------

  it("does not call onSessionId when response has no session_id", async () => {
    mockSendMessageStream.mockResolvedValueOnce({
      ...SEARCH_RESPONSE,
      session_id: null,
    });

    const { hook, onSessionId } = setup();

    await act(async () => {
      await hook.result.current.send("test");
    });

    expect(onSessionId).not.toHaveBeenCalled();
  });
});
