import assert from "node:assert/strict";
import test from "node:test";

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
