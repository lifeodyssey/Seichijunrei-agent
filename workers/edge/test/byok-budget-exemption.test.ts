import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver } from "./doubles/native-agent-receiver.ts";
import type { Env } from "../src/env.ts";
import { latchBudget, utcDayKey } from "../src/protect/cost-breaker.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";

// #284 Task 4 regression lock (edge half): an AUTHENTICATED `/v1/chat`
// request must never consult `budgetLatched` — that check is reachable
// only from `handleAnonymousV1`. This is the property that makes BYOK's
// quota exemption "free" (no new edge code needed): a future refactor that
// moved the breaker onto the shared authenticated path would silently start
// rejecting logged-in (and therefore BYOK) traffic.
//
// #479 P1 review follow-up (Fable): the first version of this file latched
// a FIXED test day (`Date.UTC(2026, 6, 28, ...)`) while the guard's own
// `handleGuardRequest` was driven by that SAME fixed `NOW` — so a mutation
// that actually wired `budgetLatched(env.EDGE_GUARD, utcDayKey(Date.now()))`
// into `authenticatedForward` was proven NOT to be caught: the mutated
// check would read "today" from the REAL system clock, find nothing
// latched there (only the fixed test day was latched), and pass through
// anyway — the test stayed green for the wrong reason. Fixed two ways: (1)
// latch the REAL current day (`utcDayKey(Date.now())`), matching what any
// clock-driven implementation — present or future — would derive, and (2)
// additionally assert directly on the guard's own call trace that no
// `/budget` GET ever reached the shard, which is a stronger, mechanism-level
// pin than the response status alone.

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function env(guard: ReturnType<typeof fakeGuard>["namespace"]): Env {
  return {
    EDGE_GUARD: guard,
    EDGE_SHOWCASE_MODE: "false",
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as unknown as Env;
}

function budgetShardWasConsulted(calls: { url: string; method: string }[]): boolean {
  return calls.some((call) => new URL(call.url).pathname === "/budget");
}

void test("an authenticated /v1/chat request succeeds even with today's anonymous budget latched", async () => {
  const nowMs = Date.now();
  const { namespace: guard, calls } = fakeGuard(nowMs);
  await latchBudget(guard, utcDayKey(nowMs));

  const app = createWorkerApp({ agentTurns: nativeAgentReceiver(),
        authenticate: () => Promise.resolve({ ok: true, userId: "user-a", userType: "human" } as const),
  });
  calls.length = 0; // only count calls made DURING the authenticated request below
  const res = await app.request(
    "/v1/chat",
    { method: "POST", headers: { Authorization: "Bearer jwt" } },
    env(guard),
    stubCtx,
  );

  assert.equal(res.status, 200, "the latched anonymous budget must never be consulted for authenticated traffic");
  assert.equal(
    budgetShardWasConsulted(calls),
    false,
    "authenticatedForward must never call budgetLatched — reachable only from handleAnonymousV1",
  );
});

void test("an authenticated BYOK request (X-BYOK-* headers present) is likewise unaffected by the latch", async () => {
  const nowMs = Date.now();
  const { namespace: guard, calls } = fakeGuard(nowMs);
  await latchBudget(guard, utcDayKey(nowMs));

  const app = createWorkerApp({ agentTurns: nativeAgentReceiver(),
        authenticate: () => Promise.resolve({ ok: true, userId: "user-a", userType: "human" } as const),
  });
  calls.length = 0;
  const res = await app.request(
    "/v1/chat",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer jwt",
        "X-BYOK-Provider": "openai-compatible",
        "X-BYOK-Key": "sk-fake",
      },
    },
    env(guard),
    stubCtx,
  );

  assert.equal(res.status, 200);
  assert.equal(budgetShardWasConsulted(calls), false);
});
