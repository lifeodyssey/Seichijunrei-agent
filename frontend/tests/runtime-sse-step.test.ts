/**
 * Tests for SSE step event parsing — observation extraction and failed status.
 */
import { describe, it, expect, vi } from "vitest";
import { parseSSEChunk, sendMessageStream } from "@/lib/api/runtime";

function makeSSE(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeStreamResponse(chunks: string[]): Response {
  const combined = chunks.join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(combined));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("parseSSEChunk step event", () => {
  it("extracts observation from top-level payload for failed steps", () => {
    const chunk = makeSSE("step", {
      tool: "resolve_anime",
      status: "failed",
      observation: "Title not found in database",
    });
    const { events } = parseSSEChunk(chunk);

    expect(events).toHaveLength(1);
    expect(events[0].payload.observation).toBe("Title not found in database");
    expect(events[0].payload.status).toBe("failed");
  });

  it("preserves failed status in parsed payload", () => {
    const chunk = makeSSE("step", {
      tool: "search_bangumi",
      status: "failed",
      observation: "Database timeout",
    });
    const { events } = parseSSEChunk(chunk);

    expect(events[0].payload.status).toBe("failed");
  });
});

describe("sendMessageStream onStep callback", () => {
  it("calls onStep with failed status and observation from top-level", async () => {
    const steps: Array<{
      tool: string;
      status: string;
      thought?: string;
      observation?: string;
    }> = [];

    const stepSSE = makeSSE("step", {
      tool: "resolve_anime",
      status: "failed",
      observation: "Title not found",
    });
    const doneSSE = makeSSE("done", {
      success: true,
      status: "error",
      intent: "search",
      session_id: "s1",
      message: "Error",
      data: {},
      session: { interaction_count: 1, route_history_count: 0 },
      route_history: [],
      errors: [],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeStreamResponse([stepSSE, doneSSE]),
    );

    await sendMessageStream("test", null, "ja", (tool, status, thought, observation) => {
      steps.push({ tool, status, thought, observation });
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].tool).toBe("resolve_anime");
    expect(steps[0].status).toBe("failed");
    expect(steps[0].observation).toBe("Title not found");

    vi.restoreAllMocks();
  });

  it("falls back to data.error when observation is absent for failed steps", async () => {
    const steps: Array<{
      tool: string;
      status: string;
      thought?: string;
      observation?: string;
    }> = [];

    const stepSSE = makeSSE("step", {
      tool: "resolve_anime",
      status: "failed",
      data: { error: "Upstream API timeout" },
    });
    const doneSSE = makeSSE("done", {
      success: true,
      status: "error",
      intent: "search",
      session_id: "s1",
      message: "Error",
      data: {},
      session: { interaction_count: 1, route_history_count: 0 },
      route_history: [],
      errors: [],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      makeStreamResponse([stepSSE, doneSSE]),
    );

    await sendMessageStream("test", null, "ja", (tool, status, thought, observation) => {
      steps.push({ tool, status, thought, observation });
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].observation).toBe("Upstream API timeout");

    vi.restoreAllMocks();
  });
});
