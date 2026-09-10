import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import type { Env } from "../src/env.ts";
import { neonAgentTurnTier, submissionOf, type TurnIdentity } from "../src/gateway/agent-turn.ts";
import { ByokProbe } from "../src/agent/byok/byok-probe.ts";

// W2-3 (#1289) — `POST /v1/byok/probe` on the edge tier, and the one refusal
// that makes "no server-key fallback" a red line rather than a preference: a
// turn whose BYOK headers are unusable is REFUSED, not quietly served on the
// deployment's own key.
//
// test-type: unit (no network, no database, no Durable Object).

const FIXTURE_KEY = "byok-test-key-0000";
const PROBE = "/v1/byok/probe";
const MEMBER: TurnIdentity = { userId: "user-1", userType: "human" };
const VISITOR: TurnIdentity = { userId: "anon_0123456789abcdef0123456789abcdef", userType: "anonymous" };

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

const VALID_BYOK = {
  "X-BYOK-Provider": "openai-compatible",
  "X-BYOK-Key": FIXTURE_KEY,
  "X-BYOK-Model": "gpt-4o-mini",
  "X-BYOK-Base-Url": "https://api.openai.com/v1",
};

/** A base URL the egress policy refuses — the "invalid credential" case. */
const HOSTILE_BYOK = { ...VALID_BYOK, "X-BYOK-Base-Url": "https://169.254.169.254/v1" };

function chatRequest(headers: Record<string, string>): Request {
  const body = JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] });
  return new Request("https://edge.test/v1/chat", { method: "POST", headers, body });
}

/** An environment whose every agent binding counts the times it was reached. */
function countingEnv(reached: string[]): Env {
  const namespace = (name: string) => ({
    idFromName: () => {
      reached.push(name);
      return "id";
    },
    get: () => ({ fetch: () => Promise.resolve(new Response(null, { status: 204 })) }),
  });
  return {
    AGENT_SESSION: namespace("AGENT_SESSION"),
    RUN_SWEEPER: namespace("RUN_SWEEPER"),
  } as unknown as Env;
}

async function errorBody(response: Response): Promise<{ code: string; message?: string }> {
  const body = (await response.json()) as { error: { code: string; message?: string } };
  return body.error;
}

/** A probe whose socket answers 401 without ever leaving the process. */
function rejectingProbe(): ByokProbe {
  const inner: typeof globalThis.fetch = () => Promise.resolve(new Response("{}", { status: 401 }));
  return new ByokProbe({ egress: { inner } });
}

// ── the red line: an unusable credential is refused, never downgraded ──────

void test("a turn carrying a credential the egress policy refuses is a 400, and no session is armed", async () => {
  const reached: string[] = [];
  const tier = neonAgentTurnTier();
  const response = await tier.chat(countingEnv(reached), chatRequest(HOSTILE_BYOK), MEMBER);
  assert.equal(response.status, 400);
  assert.equal((await errorBody(response)).code, "egress_blocked");
  assert.deepEqual(reached, [], "no run may be opened for a turn we refuse to make");
});

void test("a turn with a malformed BYOK header set is a 400, never a server-key turn", async () => {
  const reached: string[] = [];
  const headers = { "X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": FIXTURE_KEY };
  const response = await neonAgentTurnTier().chat(countingEnv(reached), chatRequest(headers), MEMBER);
  assert.equal(response.status, 400);
  assert.equal((await errorBody(response)).code, "invalid_request");
  assert.deepEqual(reached, []);
});

void test("a BYOK turn is committed on the byok payer, so its spend is metered in its own scope", async () => {
  const submission = await submissionOf(chatRequest(VALID_BYOK), MEMBER, "ja");
  assert.equal(submission.payer, "byok", "never the member's own scope — they paid the provider");
  assert.notEqual(submission.byok, undefined);
});

void test("a plain turn from the same member is still committed on the user payer", async () => {
  const submission = await submissionOf(chatRequest({}), MEMBER, "ja");
  assert.equal(submission.payer, "user");
});

// ── BYOK is login-gated on both routes that accept it ──────────────────────

void test("an anonymous visitor sending BYOK headers to a turn is told to log in", async () => {
  const reached: string[] = [];
  const response = await neonAgentTurnTier().chat(countingEnv(reached), chatRequest(VALID_BYOK), VISITOR);
  assert.equal(response.status, 403);
  assert.equal((await errorBody(response)).code, "byok_requires_login");
  assert.deepEqual(reached, []);
});

void test("the login gate runs before header parsing, so a malformed set still says log in", async () => {
  const request = new Request(`https://edge.test${PROBE}`, { method: "POST", headers: HOSTILE_BYOK });
  const response = await neonAgentTurnTier(rejectingProbe()).probe(request, VISITOR);
  assert.equal(response.status, 403);
  assert.equal((await errorBody(response)).code, "byok_requires_login");
});

// ── the probe itself ───────────────────────────────────────────────────────

void test("a probe with no BYOK headers at all is the documented 400", async () => {
  const request = new Request(`https://edge.test${PROBE}`, { method: "POST" });
  const response = await neonAgentTurnTier(rejectingProbe()).probe(request, MEMBER);
  assert.equal(response.status, 400);
  assert.equal((await errorBody(response)).code, "invalid_request");
});

void test("a probe with a refused base url answers the egress rejection, not a verdict", async () => {
  const request = new Request(`https://edge.test${PROBE}`, { method: "POST", headers: HOSTILE_BYOK });
  const response = await neonAgentTurnTier(rejectingProbe()).probe(request, MEMBER);
  assert.equal(response.status, 400);
  assert.equal((await errorBody(response)).code, "egress_blocked");
});

void test("a probe whose provider rejects the key answers the contract's verdict shape", async () => {
  const request = new Request(`https://edge.test${PROBE}`, { method: "POST", headers: VALID_BYOK });
  const response = await neonAgentTurnTier(rejectingProbe()).probe(request, MEMBER);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    vision: false,
    reachable: false,
    error_code: "byok_credential_rejected",
  });
});

// ── the route stays behind the same wall it is behind today ───────────────

void test('an unauthenticated probe is 401 under "edge" too, never the anonymous pipeline', async () => {
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    AGENT_TURN_ROUTE: "edge",
    ANON_ACCESS_ENABLED: "true",
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as unknown as Env;
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
  });
  const response = await app.request(PROBE, { method: "POST", headers: VALID_BYOK }, env, stubCtx);
  assert.equal(response.status, 401);
});
