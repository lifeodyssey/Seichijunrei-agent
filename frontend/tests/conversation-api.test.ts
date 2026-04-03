import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeResponse } from "../lib/types";

process.env.NEXT_PUBLIC_RUNTIME_URL = "https://runtime.example";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

const api = require("../lib/api") as typeof import("../lib/api");
const { supabase } = require("../lib/supabase") as typeof import("../lib/supabase");

function setAccessToken(token: string | null) {
  Object.defineProperty(supabase.auth, "getSession", {
    configurable: true,
    value: async () => ({
      data: {
        session: token ? { access_token: token } : null,
      },
    }),
  });
}

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

function buildRuntimeResponse(overrides: Partial<RuntimeResponse> = {}): RuntimeResponse {
  return {
    success: true,
    status: "ok",
    intent: "search_nearby",
    session_id: "sess-stream",
    message: "Done",
    data: {
      results: {
        rows: [],
        row_count: 0,
        strategy: "geo",
        status: "empty",
      },
      message: "Done",
      status: "empty",
    },
    session: {
      interaction_count: 1,
      route_history_count: 0,
    },
    route_history: [],
    errors: [],
    ...overrides,
  };
}

test("fetchConversations returns an empty list when the user is unauthenticated", async () => {
  setAccessToken(null);
  let fetchCalled = false;
  global.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  }) as typeof fetch;

  const records = await api.fetchConversations();

  assert.deepEqual(records, []);
  assert.equal(fetchCalled, false);
});

test("fetchConversations sends an authorized GET request", async () => {
  setAccessToken("token-123");
  const payload = [
    {
      session_id: "sess-1",
      title: "宇治巡礼",
      first_query: "宇治の聖地を探して",
      created_at: "2026-04-02T00:00:00.000Z",
      updated_at: "2026-04-02T01:00:00.000Z",
    },
  ];
  let fetchArgs: Parameters<typeof fetch> | null = null;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchArgs = args;
    return {
      ok: true,
      json: async () => payload,
    } as Response;
  }) as typeof fetch;

  const records = await api.fetchConversations();

  assert.deepEqual(records, payload);
  assert.equal(fetchArgs?.[0], "https://runtime.example/v1/conversations");
  assert.deepEqual(fetchArgs?.[1], {
    headers: {
      Authorization: "Bearer token-123",
    },
  });
});

test("patchConversationTitle encodes the session id and sends the title", async () => {
  setAccessToken("token-123");
  let fetchArgs: Parameters<typeof fetch> | null = null;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchArgs = args;
    return {
      ok: true,
    } as Response;
  }) as typeof fetch;

  await api.patchConversationTitle("sess/1", "  宇治  ");

  assert.equal(
    fetchArgs?.[0],
    "https://runtime.example/v1/conversations/sess%2F1",
  );
  assert.deepEqual(fetchArgs?.[1], {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token-123",
    },
    body: JSON.stringify({ title: "  宇治  " }),
  });
});

test("patchConversationTitle throws when the rename request fails", async () => {
  setAccessToken("token-123");
  global.fetch = (async () =>
    ({
      ok: false,
      status: 500,
    }) as Response) as typeof fetch;

  await assert.rejects(
    () => api.patchConversationTitle("sess-1", "宇治"),
    /Rename failed \(500\)/,
  );
});

test("sendSelectedRoute posts selected ids, origin, locale, and auth", async () => {
  setAccessToken("token-123");
  const response = buildRuntimeResponse({
    intent: "plan_selected",
    message: "Created a route with 2 selected stops.",
  });
  let fetchArgs: Parameters<typeof fetch> | null = null;

  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchArgs = args;
    return {
      ok: true,
      json: async () => response,
    } as Response;
  }) as typeof fetch;

  const result = await api.sendSelectedRoute(
    ["point-1", "point-2"],
    "Uji Station",
    "sess-selected",
    "en",
  );

  assert.deepEqual(result, response);
  assert.equal(fetchArgs?.[0], "https://runtime.example/v1/runtime");
  const requestInit = fetchArgs?.[1] as RequestInit | undefined;
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(requestInit?.headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer token-123",
  });
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    text: "Create a route with 2 selected stops from Uji Station.",
    session_id: "sess-selected",
    locale: "en",
    selected_point_ids: ["point-1", "point-2"],
    origin: "Uji Station",
  });
});

test("sendMessageStream parses SSE frames that use event lines", async () => {
  setAccessToken("token-123");
  const response = buildRuntimeResponse({
    session_id: "sess-event-lines",
    message: "Route ready",
  });
  const seenSteps: Array<{ tool: string; status: "running" | "done" }> = [];

  global.fetch = (async () =>
    ({
      ok: true,
      body: createStream([
        'event: step\ndata: {"tool":"resolve_points","status":"running"}\n\n',
        'event: step\ndata: {"tool":"resolve_points","status":"done"}\n\n',
        `event: done\ndata: ${JSON.stringify(response)}\n\n`,
      ]),
    }) as Response) as typeof fetch;

  const result = await api.sendMessageStream(
    "make a route",
    "sess-legacy",
    "en",
    (tool, status) => {
      seenSteps.push({ tool, status });
    },
  );

  assert.deepEqual(seenSteps, [
    { tool: "resolve_points", status: "running" },
    { tool: "resolve_points", status: "done" },
  ]);
  assert.deepEqual(result, response);
});

test("sendMessageStream keeps supporting legacy JSON event payloads", async () => {
  setAccessToken("token-123");
  const response = buildRuntimeResponse({
    session_id: "sess-legacy-json",
    message: "Legacy stream parsed",
  });
  const seenSteps: Array<{ tool: string; status: "running" | "done" }> = [];

  global.fetch = (async () =>
    ({
      ok: true,
      body: createStream([
        'data: {"event":"step","tool":"search_bangumi","status":"running"}\n\n',
        `data: ${JSON.stringify({ event: "done", ...response })}\n\n`,
      ]),
    }) as Response) as typeof fetch;

  const result = await api.sendMessageStream(
    "legacy parser",
    "sess-legacy",
    "en",
    (tool, status) => {
      seenSteps.push({ tool, status });
    },
  );

  assert.deepEqual(seenSteps, [
    { tool: "search_bangumi", status: "running" },
  ]);
  assert.deepEqual(result, response);
});
