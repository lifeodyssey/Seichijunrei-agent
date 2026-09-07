/**
 * E-1 (#1380) against real PostgreSQL: what a seeded frozen prefix leaves in
 * the turn tables, on the committed `migrations/neon` chain.
 *
 * Three of its properties can only be told the truth by a database. The
 * settlement is `run_steps_settled_check` — `result` and `finished_at` must
 * land together — and a double can only pretend to hold it. The terminal run
 * is `runs_one_running_per_session`, a partial unique index: a prefix left
 * `running` would make the very turn under measurement a 409, which is
 * observable here and nowhere else. And idempotency is
 * `messages_session_client_message_id`, so a re-seeding must leave the row
 * COUNTS unchanged rather than merely answer the same way.
 *
 * The envelope half is NOT here: it lives in Durable Object storage, which no
 * database can see (`trajectory-prefix-seed.test.ts` owns it).
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { NeonTurnRecords } from "../src/agent/intake/neon-turn-records.ts";
import { SessionOwnershipError } from "../src/agent/intake/turn-intake.ts";
import { SessionNotEmptyError, seedTrajectoryPrefix, type PrefixSeedingParts } from "../src/agent/session/prefix-seeding.ts";
import { prefixSeedingOn } from "../src/agent/session/session-prefix.ts";
import { DurableEnvelopeStore } from "../src/agent/session/durable-envelope-store.ts";
import { NeonSeededSession } from "../src/agent/session/neon-seeded-session.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { countRows, onlyRow } from "./agent-rows.ts";
import {
  makePrefixSeedingRequest,
  SEEDING_IDENTITY,
} from "../test/doubles/make-trajectory-prefix.ts";
import { InMemoryEnvelopeStorage } from "./in-memory-envelope-storage.ts";

const NOW = Date.parse("2026-09-06T09:00:00.000Z");

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: SETUP_HOOK_TIMEOUT_MS });
after(() => plane.stop(), { timeout: 60_000 });

/** The real adapters under test, over one transaction seam — the wiring
 * `session-prefix.ts` builds inside the Durable Object. */
function seedingParts(): PrefixSeedingParts {
  return {
    records: new NeonSeededSession(plane.transactions),
    turns: new NeonTurnRecords(plane.transactions),
    store: new NeonTurnStore(plane.transactions),
    envelopes: new DurableEnvelopeStore(new InMemoryEnvelopeStorage()),
    owner: "do-incarnation-1",
    prices: { inputUsdPerMtok: 0, outputUsdPerMtok: 0 },
    now: () => NOW,
  };
}

/** The one run of one session, as the database holds it. */
async function runOf(sessionId: string): Promise<Record<string, unknown>> {
  const found = await plane.database.execute(
    sql`select id, status from runs where session_id = ${sessionId}`,
  );
  return onlyRow(found);
}

/** The one settled step of one run, as `run_steps` holds it. */
async function stepOf(runId: string): Promise<Record<string, unknown>> {
  const found = await plane.database.execute(
    sql`select tool_name, input, result, finished_at from run_steps where run_id = ${runId}`,
  );
  return onlyRow(found);
}

async function messageRoles(sessionId: string): Promise<string[]> {
  const found = await plane.database.execute(
    sql`select role from messages where session_id = ${sessionId} order by created_at, id`,
  );
  return found.rows.map((row) => String((row as { role: unknown }).role));
}

void test("a seeded prefix commits the user turn, the tool call and the answer", async () => {
  const request = makePrefixSeedingRequest({ sessionId: "prefix-rows" });

  const receipt = await seedTrajectoryPrefix(seedingParts(), request);

  assert.equal(receipt.seeded, true);
  assert.deepEqual(await messageRoles("prefix-rows"), ["user", "assistant", "assistant"]);
});

void test("the seeded run is terminal, so the measured turn is not refused as busy", async () => {
  const request = makePrefixSeedingRequest({ sessionId: "prefix-terminal" });

  await seedTrajectoryPrefix(seedingParts(), request);

  assert.equal(await runOf("prefix-terminal").then((row) => row.status), "succeeded");
});

void test("the step lands settled: its result and its finished_at together", async () => {
  const request = makePrefixSeedingRequest({ sessionId: "prefix-step" });

  await seedTrajectoryPrefix(seedingParts(), request);

  const step = await stepOf(String((await runOf("prefix-step")).id));
  assert.equal(step.tool_name, "resolve_anime");
  assert.notEqual(step.finished_at, null);
  assert.deepEqual(step.input, request.prefix.toolCall.params);
});

void test("the session is owned by the identity the seeding was made for", async () => {
  await seedTrajectoryPrefix(seedingParts(), makePrefixSeedingRequest({ sessionId: "prefix-owner" }));

  const found = await plane.database.execute(sql`select user_id from sessions where id = 'prefix-owner'`);
  assert.equal(onlyRow(found).user_id, SEEDING_IDENTITY);
});

void test("re-seeding the same case writes no second row", async () => {
  const request = makePrefixSeedingRequest({ sessionId: "prefix-idempotent" });
  await seedTrajectoryPrefix(seedingParts(), request);
  const messagesBefore = await countRows(plane.database, "messages");
  const runsBefore = await countRows(plane.database, "runs");

  const replay = await seedTrajectoryPrefix(seedingParts(), request);

  assert.equal(replay.seeded, false);
  assert.equal(await countRows(plane.database, "messages"), messagesBefore);
  assert.equal(await countRows(plane.database, "runs"), runsBefore);
});

/**
 * The composition the Durable Object actually seeds through (#1436), rather
 * than the hand-wired `seedingParts` above: `prefixSeedingOn` picks the
 * adapters itself, and only the pool is substituted — this lane's PostgreSQL
 * is reached by node-postgres, while `agentDatabaseIn` opens a Neon
 * WebSocket pool that no container speaks (`postgres-arm.ts`).
 *
 * What it is here to prove is that a refusal crosses that composition AS ITS
 * CLASS. `session-prefix.ts`'s `refusalFor` reads the class and nothing else,
 * so a seeding that wrapped or replaced it would answer every refusal 500 —
 * and every case that pins a status hands the port its error ready-made and
 * would never see it.
 */
void test("a refusal crosses the composed seeding as the class refusalFor reads", async () => {
  const owned = makePrefixSeedingRequest({ sessionId: "prefix-composed" });
  await seedTrajectoryPrefix(seedingParts(), owned);
  const parts = {
    env: {}, envelopes: new DurableEnvelopeStore(new InMemoryEnvelopeStorage()), owner: "do-incarnation-1",
  };

  const seeding = prefixSeedingOn(parts, (work) => work(plane.transactions));

  await assert.rejects(
    seeding({ ...owned, identityId: "another-identity" }),
    (error: unknown) => error instanceof SessionOwnershipError,
  );
});

void test("a different case may not seed a session that already took a turn", async () => {
  const request = makePrefixSeedingRequest({ sessionId: "prefix-occupied" });
  await seedTrajectoryPrefix(seedingParts(), request);
  const other = makePrefixSeedingRequest({
    sessionId: "prefix-occupied",
    prefix: { ...request.prefix, caseId: "phase1c_selection_v1/D3_multi_success_single" },
  });

  await assert.rejects(
    seedTrajectoryPrefix(seedingParts(), other),
    (error: unknown) => error instanceof SessionNotEmptyError,
  );
});
