import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for clarify SSE event handling in sendMessageStream.
 *
 * We mock fetch to return a ReadableStream that emits SSE events,
 * then verify sendMessageStream correctly captures clarify data
 * from step events and merges it into the done response.
 */

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

function mockFetchWithSSE(chunks: string[]) {
  const stream = createSSEStream(chunks);
  return vi.fn().mockResolvedValue({
    ok: true,
    body: stream,
    json: vi.fn(),
  });
}

describe("sendMessageStream clarify handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("resolves with needs_clarification when step has tool=clarify", async () => {
    const sseChunks = [
      "event: step\ndata: " +
        JSON.stringify({
          tool: "clarify",
          status: "done",
          question: "Which anime do you mean?",
          options: ["Steins;Gate", "Steins;Gate 0"],
        }) +
        "\n\n",
      "event: done\ndata: " +
        JSON.stringify({
          intent: "clarify",
          success: true,
          status: "ok",
          message: "Please clarify",
          session_id: "sess-1",
          data: {},
          session: { interaction_count: 1, route_history_count: 0 },
          route_history: [],
          errors: [],
        }) +
        "\n\n",
    ];

    vi.stubGlobal("fetch", mockFetchWithSSE(sseChunks));

    const { sendMessageStream } = await import("../api");
    const result = await sendMessageStream("test query", "sess-1", "ja");

    expect(result.status).toBe("needs_clarification");
    const data = result.data as unknown as Record<string, unknown>;
    expect(data.question).toBe("Which anime do you mean?");
    expect(data.options).toEqual(["Steins;Gate", "Steins;Gate 0"]);
  });

  it("resolves with needs_clarification when clarify has empty options", async () => {
    const sseChunks = [
      "event: step\ndata: " +
        JSON.stringify({
          tool: "clarify",
          status: "done",
          question: "What do you want to search?",
          options: [],
        }) +
        "\n\n",
      "event: done\ndata: " +
        JSON.stringify({
          intent: "clarify",
          success: true,
          status: "ok",
          message: "Please clarify",
          session_id: "sess-2",
          data: {},
          session: { interaction_count: 1, route_history_count: 0 },
          route_history: [],
          errors: [],
        }) +
        "\n\n",
    ];

    vi.stubGlobal("fetch", mockFetchWithSSE(sseChunks));

    const { sendMessageStream } = await import("../api");
    const result = await sendMessageStream("test", "sess-2", "ja");

    expect(result.status).toBe("needs_clarification");
    const data = result.data as unknown as Record<string, unknown>;
    expect(data.question).toBe("What do you want to search?");
    expect(data.options).toEqual([]);
  });

  it("throws on malformed clarify JSON in step event", async () => {
    const sseChunks = [
      "event: step\ndata: {tool: clarify, INVALID JSON\n\n",
    ];

    vi.stubGlobal("fetch", mockFetchWithSSE(sseChunks));

    const { sendMessageStream } = await import("../api");
    await expect(
      sendMessageStream("test", "sess-3", "ja"),
    ).rejects.toThrow();
  });
});
