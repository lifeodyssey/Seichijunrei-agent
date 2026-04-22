import { http, HttpResponse, delay } from "msw";
import {
  MOCK_SEARCH_RESPONSE,
  MOCK_ROUTE_RESPONSE,
  MOCK_CLARIFY_RESPONSE,
  MOCK_NEARBY_RESPONSE,
  MOCK_GREET_RESPONSE,
} from "../lib/mock-data";
import type { RuntimeResponse } from "../lib/types";

/**
 * Classify user query → pick the right mock response.
 */
function classifyQuery(text: string): RuntimeResponse {
  const t = text.toLowerCase();
  if (t.includes("涼宮") || t.includes("haruhi") || t.includes("凉宫") || t.includes("clarify")) {
    return MOCK_CLARIFY_RESPONSE;
  }
  if (t.includes("附近的圣地") || t.includes("nearby spots for")) {
    return MOCK_SEARCH_RESPONSE;
  }
  if (t.includes("附近") || t.includes("near") || t.includes("nearby") || t.includes("近く")) {
    return MOCK_NEARBY_RESPONSE;
  }
  if (t.includes("路线") || t.includes("route") || t.includes("ルート") || t.includes("plan")) {
    return MOCK_ROUTE_RESPONSE;
  }
  // Default: search
  return MOCK_SEARCH_RESPONSE;
}

/**
 * Build SSE text from a RuntimeResponse — mimics backend SSE protocol.
 * Events: step (tool running) → step (tool done) → done (final response)
 */
function buildSSE(response: RuntimeResponse): string {
  const intent = response.intent ?? "search_bangumi";
  const lines: string[] = [];

  // Step 1: tool running
  lines.push(`event: step`);
  lines.push(`data: ${JSON.stringify({ event: "step", tool: intent, status: "running", message: "Searching..." })}`);
  lines.push("");

  // Step 2: tool done
  lines.push(`event: step`);
  lines.push(`data: ${JSON.stringify({ event: "step", tool: intent, status: "done", message: "Done" })}`);
  lines.push("");

  // Done event: full response
  lines.push(`event: done`);
  lines.push(`data: ${JSON.stringify({ event: "done", ...response })}`);
  lines.push("");

  return lines.join("\n");
}

export const handlers = [
  // ── POST /v1/runtime (sync) ────────────────────────────────────
  http.post("*/v1/runtime", async ({ request }) => {
    const body = (await request.json()) as { text?: string };
    const text = body.text ?? "";

    await delay(800);

    const response = classifyQuery(text);
    return HttpResponse.json(response);
  }),

  // ── POST /v1/runtime/stream (SSE) ──────────────────────────────
  http.post("*/v1/runtime/stream", async ({ request }) => {
    const body = (await request.json()) as { text?: string };
    const text = body.text ?? "";

    const response = classifyQuery(text);
    const sseText = buildSSE(response);

    // Stream SSE with delays between events
    const encoder = new TextEncoder();
    const chunks = sseText.split("\n\n").filter(Boolean);

    const stream = new ReadableStream({
      async start(controller) {
        for (const chunk of chunks) {
          await new Promise((r) => setTimeout(r, 500));
          controller.enqueue(encoder.encode(chunk + "\n\n"));
        }
        controller.close();
      },
    });

    return new HttpResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }),

  // ── GET /v1/bangumi/popular ────────────────────────────────────
  http.get("*/v1/bangumi/popular", async () => {
    await delay(300);
    return HttpResponse.json([
      { bangumi_id: "115908", title: "響け！ユーフォニアム", cover_url: "https://image.anitabi.cn/bangumi/115908.jpg?plan=h160" },
      { bangumi_id: "160209", title: "君の名は。", cover_url: "https://image.anitabi.cn/bangumi/160209.jpg?plan=h160" },
      { bangumi_id: "269235", title: "天気の子", cover_url: "https://image.anitabi.cn/bangumi/269235.jpg?plan=h160" },
      { bangumi_id: "485", title: "涼宮ハルヒの憂鬱", cover_url: "https://image.anitabi.cn/bangumi/485.jpg" },
      { bangumi_id: "1424", title: "けいおん！", cover_url: "https://image.anitabi.cn/bangumi/1424.jpg" },
      { bangumi_id: "362577", title: "すずめの戸締まり", cover_url: "https://image.anitabi.cn/bangumi/362577.jpg" },
    ]);
  }),
];
