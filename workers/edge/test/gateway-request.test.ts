import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver } from "./doubles/native-agent-receiver.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";

// EDGE-1 #963 composed-seam tests: HandleGatewayRequest runs identity,
// protection, route selection, internal-identity construction, and
// forwarding in that order. These pin the composition itself — the order
// guards run relative to forwarding, upstream-failure pass-through, and
// disconnect (SSE) pass-through — at the seam, not inside any one adapter.

const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function recordingAgent(events: string[], body: Response = new Response("agent")) {
  return nativeAgentReceiver([], () => { events.push("agent"); return body; });
}

function authedApp(agentTurns = nativeAgentReceiver()) {
  return createWorkerApp({ agentTurns,
    authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const),
  });
}

const POST = { method: "POST", headers: { Authorization: "Bearer jwt" } };

void test("the authenticated limiter runs BEFORE the native tier — a denied request never forwards", async () => {
  const events: string[] = [];
  const guard = fakeGuard(NOW);
  const env = {
    EDGE_GUARD: guard.namespace,
    EDGE_SHOWCASE_MODE: "false",
    AUTH_RATE_LIMIT: "1",
  } as never;
  const app = authedApp(recordingAgent(events));
  const first = await app.request("/v1/chat", POST, env, stubCtx);
  assert.equal(first.status, 200, "the first request spends the one-request window");
  const denied = await app.request("/v1/chat", POST, env, stubCtx);
  assert.equal(denied.status, 429);
  assert.equal(guard.calls.length, 2, "the limiter shard must be consulted for every request");
  assert.equal(events.length, 1, "forwarding before guards is the rollback mutation — a denied request must not reach the native tier");
});

void test("the anonymous pipeline consults turnstile, limiter, budget, then native tier, in order", async () => {
  const sequence: string[] = [];
  const guard = fakeGuard(NOW);
  const guardNamespace = {
    idFromName: (name: string) => guard.namespace.idFromName(name),
    get: (id: DurableObjectId) => ({
      fetch: (request: Request) => {
        sequence.push(`guard:${new URL(request.url).pathname}`);
        return guard.namespace.get(id).fetch(request);
      },
    }),
  };
  const gate = {
    check: () => { sequence.push("turnstile"); return Promise.resolve({ ok: true, errorCodes: [] }); },
  };
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
    turnstileGate: gate,
    agentTurns: recordingAgent(sequence),
  });
  const env = {
    ANON_ACCESS_ENABLED: "true",
    ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: guardNamespace,
  } as never;
  const res = await app.request("/v1/chat", { method: "POST" }, env, stubCtx);
  assert.equal(res.status, 200);
  assert.deepEqual(sequence, ["turnstile", "guard:/rate-limit", "guard:/budget", "agent"]);
});

void test("a native tier failure passes through unchanged", async () => {
  const env = {
    EDGE_GUARD: fakeGuard(NOW).namespace,
    EDGE_SHOWCASE_MODE: "false",
  } as never;
  const res = await authedApp(recordingAgent([], new Response("boom", { status: 503 }))).request("/v1/chat", POST, env, stubCtx);
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "boom");
});

void test("a catalog 5xx passes through unchanged on the public overview", async () => {
  const app = createWorkerApp({});
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    CATALOG: { fetch: () => Promise.resolve(new Response("catalog down", { status: 502 })) },
  } as never;
  const res = await app.request("/catalog/public/anime-overview/3302", {}, env, stubCtx);
  assert.equal(res.status, 502);
  assert.equal(await res.text(), "catalog down");
});

void test("a still-open native stream is passed through without draining (disconnect)", async () => {
  let release: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      release = () => { controller.close(); };
    },
  });
  const env = {
    EDGE_GUARD: fakeGuard(NOW).namespace,
    EDGE_SHOWCASE_MODE: "false",
  } as never;
  const response = await Promise.race([
    authedApp(nativeAgentReceiver([], () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }))).fetch(new Request("https://animichi.test/v1/chat", POST), env, stubCtx),
    new Promise<"drained">((resolve) => { setTimeout(() => { resolve("drained"); }, 1_000); }),
  ]);
  assert.notEqual(response, "drained", "the seam drained the stream instead of handing it back");
  assert.equal((response as Response).status, 200);
  release?.();
});

async function withWarnSpy(run: () => Promise<Response> | Response): Promise<{ response: Response; warnings: Record<string, unknown>[] }> {
  const raw: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => { raw.push(String(line)); };
  try {
    const response = await run();
    return { response, warnings: raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
  } finally {
    console.warn = original;
  }
}

void test("the seam records class, status and duration, never identity material", async () => {
  const env = {
    EDGE_GUARD: fakeGuard(NOW).namespace,
    EDGE_SHOWCASE_MODE: "false",
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as never;
  const { warnings } = await withWarnSpy(() => authedApp().request("/v1/chat", POST, env, stubCtx));
  const record = warnings.find((entry) => entry.event === "edge_gateway_request");
  assert.ok(record, "the completion record must be logged");
  assert.equal(record.class, "v1");
  assert.equal(record.status, 200);
  assert.equal(typeof record.duration_ms, "number");
  assert.equal("userId" in record, false);
  assert.equal("Authorization" in record, false);
  assert.equal("path" in record, false);
});

void test("an entry log precedes dispatch and carries no path or identity material", async () => {
  const env = {
    EDGE_GUARD: fakeGuard(NOW).namespace,
    EDGE_SHOWCASE_MODE: "false",
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as never;
  const { warnings } = await withWarnSpy(() => authedApp().request("/v1/chat", POST, env, stubCtx));

  assert.equal(warnings.length, 2, "one entry record plus the existing completion record");
  const entry = warnings[0];
  const completion = warnings[1];
  assert.ok(entry, "the entry record must be logged");
  assert.ok(completion, "the completion record must be logged");
  assert.equal(entry.event, "edge_gateway_request_start");
  assert.equal(entry.class, "v1");
  assert.equal(entry.method, "POST");
  assert.equal("pathname" in entry, false, "pathnames carry ids like /v1/conversations/{session_id}");
  assert.equal("userId" in entry, false);
  assert.equal("Authorization" in entry, false);
  assert.equal(completion.event, "edge_gateway_request");
});
