/**
 * AC: sendMessageStream writes origin_lat/origin_lng to request body when coords provided -> unit
 * AC: sendMessageStream omits origin_lat/origin_lng when coords is null/undefined -> unit
 * AC: useChat.send() forwards coords to sendMessageStream -> unit
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
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

function makeDoneChunk(extra: Record<string, unknown> = {}): string {
  return (
    "event: done\ndata: " +
    JSON.stringify({
      intent: "greet_user",
      success: true,
      status: "ok",
      message: "hi",
      session_id: "sess-1",
      data: {},
      session: { interaction_count: 1, route_history_count: 0 },
      route_history: [],
      errors: [],
      ...extra,
    }) +
    "\n\n"
  );
}

describe("sendMessageStream coords wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("writes origin_lat and origin_lng when coords are provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([makeDoneChunk()]),
      json: vi.fn(),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { sendMessageStream } = await import("@/lib/api/runtime");
    await sendMessageStream("test", "sess-1", "ja", undefined, undefined, {
      lat: 35.0,
      lng: 135.0,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.origin_lat).toBe(35.0);
    expect(body.origin_lng).toBe(135.0);
  });

  it("omits origin_lat and origin_lng when coords is null", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([makeDoneChunk()]),
      json: vi.fn(),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { sendMessageStream } = await import("@/lib/api/runtime");
    await sendMessageStream("test", "sess-1", "ja", undefined, undefined, null);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.origin_lat).toBeUndefined();
    expect(body.origin_lng).toBeUndefined();
  });

  it("omits origin_lat and origin_lng when coords is undefined", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEStream([makeDoneChunk()]),
      json: vi.fn(),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { sendMessageStream } = await import("@/lib/api/runtime");
    await sendMessageStream("test", "sess-1", "ja");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.origin_lat).toBeUndefined();
    expect(body.origin_lng).toBeUndefined();
  });
});
