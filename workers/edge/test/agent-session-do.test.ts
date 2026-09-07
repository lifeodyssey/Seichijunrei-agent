/**
 * W1-3 (#1252): the two calls `AgentSession` answers, and the storage between
 * them.
 *
 * `fetch` and `alarm()` are separate calls on one incarnation, and the run id
 * has to survive the gap — including an eviction and the platform's own alarm
 * retry — so the arm writes it to STORAGE, not to a field. The storage here is
 * a real Map-backed one rather than a stand-in that pretends to be storage.
 *
 * What is NOT covered here, and is not covered anywhere automatically: the
 * alarm's own drive (`withAgentDatabase` → `NeonTurnStore` → `DurableTurn`)
 * reaches Neon over the WebSocket driver, which no lane can stand up — the
 * `agent-db-test/` lane proves the turn loop and its statements against
 * node-postgres, not this wiring. What CAN be proved without a database is the
 * two calls' behaviour when they cannot reach one, and both are below: an
 * alarm that fails leaves the run QUEUED, which is what makes the platform's
 * retry an at-least-once backstop rather than a lost turn, and a seeding that
 * fails reports the missing binding rather than dressing it as a refusal
 * (#1436). The rest is staging validation.
 *
 * test-type: unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AgentSession, SESSION_STREAM_PATH } from "../src/agent/session/agent-session.ts";
import { SessionRunQueue } from "../src/agent/session/session-run-queue.ts";
import { prefixSeedRequest } from "../src/agent/session/session-prefix.ts";
import { armRequest } from "../src/agent/session/session-wakeup.ts";
import { makePrefixBody, SEEDING_IDENTITY } from "./doubles/make-trajectory-prefix.ts";

const RUN_ID = "11111111-2222-3333-4444-555555555555";

class MapStorage {
  readonly values = new Map<string, unknown>();
  alarmAt: number | null = null;

  put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.values.get(key));
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.values.delete(key));
  }

  list(options: { prefix: string }): Promise<Map<string, unknown>> {
    const held = [...this.values].filter(([key]) => key.startsWith(options.prefix));
    return Promise.resolve(new Map(held));
  }

  setAlarm(when: number): Promise<void> {
    this.alarmAt = when;
    return Promise.resolve();
  }
}

function makeSession(storage: MapStorage): AgentSession {
  const ctx = { id: { toString: () => "do-1" }, storage } as unknown as DurableObjectState;
  return new AgentSession(ctx, {});
}

function streamRequest(query: string): Request {
  return new Request(`https://agent-session${SESSION_STREAM_PATH}${query}`);
}

void test("an arm request queues the run and arms the alarm now", async () => {
  const storage = new MapStorage();
  const response = await makeSession(storage).fetch(armRequest(RUN_ID));
  assert.equal(response.status, 204);
  assert.deepEqual(await new SessionRunQueue(storage).pending(), [RUN_ID]);
  assert.equal(typeof storage.alarmAt, "number");
});

void test("an arm request naming no run is refused rather than queued", async () => {
  const storage = new MapStorage();
  const request = new Request("https://agent-session/arm", { method: "POST", body: "{}" });
  assert.equal((await makeSession(storage).fetch(request)).status, 400);
  assert.equal(storage.alarmAt, null);
});

void test("a stream request answers an SSE body for that run", async () => {
  const session = makeSession(new MapStorage());
  await session.fetch(armRequest(RUN_ID));
  const response = await session.fetch(streamRequest(`?runId=${RUN_ID}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  await response.body?.cancel();
});

void test("a stream request naming no run is a 404, not an empty stream", async () => {
  assert.equal((await makeSession(new MapStorage()).fetch(streamRequest(""))).status, 404);
});

/** The other half of that refusal, and the reason it is not cosmetic: this
 * session owes no work for the run, so nothing would ever write a frame or a
 * terminator to the subscriber. A 404 sends the client to the retrieval
 * surface (#1254); a stream would leave it waiting for a turn that is over. */
void test("a stream request for a run this session does not owe work for is a 404", async () => {
  const response = await makeSession(new MapStorage()).fetch(streamRequest(`?runId=${RUN_ID}`));
  assert.equal(response.status, 404);
});

void test("any other path on the session is a 404", async () => {
  const request = new Request("https://agent-session/anything");
  assert.equal((await makeSession(new MapStorage()).fetch(request)).status, 404);
});

void test("a queued run stays queued until it is dequeued", async () => {
  const storage = new MapStorage();
  const queue = new SessionRunQueue(storage);
  await queue.queue(RUN_ID);
  await queue.queue("other-run");
  await queue.dequeue(RUN_ID);
  assert.deepEqual(await queue.pending(), ["other-run"]);
});

void test("a value under the pending prefix that is not a run id is dropped", async () => {
  const storage = new MapStorage();
  await storage.put("pending:corrupt", { not: "a run id" });
  assert.deepEqual(await new SessionRunQueue(storage).pending(), []);
});

/** The at-least-once property, from the alarm's side: a drive that throws must
 * not dequeue, or the platform's own retry would find nothing to redo. */
void test("an alarm that cannot reach the database leaves the run queued", async () => {
  const storage = new MapStorage();
  const session = makeSession(storage);
  await session.fetch(armRequest(RUN_ID));
  await assert.rejects(() => session.alarm(), /AGENT_SVC_DATABASE_URL is not bound/);
  assert.deepEqual(await new SessionRunQueue(storage).pending(), [RUN_ID]);
});

/**
 * The seeding hop's half of the same wiring (#1436). A readable request must
 * get all the way to the data plane, and the failure it meets there must
 * arrive as the data plane's own — a session with no binding says so, rather
 * than being answered as one of `refusalFor`'s four refusals or as a receipt.
 * That is what makes this a session that seeds through `agentDatabaseIn` and
 * not through anything a test could have handed it.
 */
void test("a seeding on a session that cannot reach the database reports the binding, not a refusal", async () => {
  const session = makeSession(new MapStorage());
  const seed = prefixSeedRequest("session-42", SEEDING_IDENTITY, JSON.stringify(makePrefixBody()));

  await assert.rejects(() => session.fetch(seed), /AGENT_SVC_DATABASE_URL is not bound/);
});
