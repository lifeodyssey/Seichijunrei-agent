/**
 * W1-3 (#1252) against real PostgreSQL: the two recovery properties the spec
 * makes hard requirements, proven on the committed `migrations/neon` chain.
 *
 * Only a database can answer either one. The reclaim is a compare-and-set
 * whose predicate is the DATABASE's clock, so a double could only restate the
 * predicate rather than test it; and the Appendix C replay turns on
 * `(run_id, step_index)` being a primary key and on the assistant tool-call
 * message riding the SAME transaction as the step row — both of which are the
 * schema's promises, not this code's.
 *
 * The tool counts its own real executions, so "the step was replayed" is
 * measured as "the tool did not run again", never asserted about a flag.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import { CountingSpotLookup, makeScriptedTurnModel, makeSessionTurnParts } from "../test/doubles/make-turn-parts.ts";
import { onlyRow, seedSession, type AgentArmDatabase } from "./agent-rows.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";

const SESSION = "session-w13";
const OWNER = "do-incarnation-2";
const STALE_OWNER = "do-incarnation-1";
const PRICES = { inputUsdPerMtok: 0, outputUsdPerMtok: 0 };

let plane: AgentDataPlane;

before(async () => {
  plane = await startAgentDataPlane();
}, { timeout: SETUP_HOOK_TIMEOUT_MS });

after(async () => {
  await plane.stop();
});

/** A `running` run whose lease belongs to an incarnation that is long gone. */
async function seedStrandedRun(database: AgentArmDatabase, sessionId: string): Promise<string> {
  await seedSession(database, sessionId);
  const message = await database.execute(
    sql`insert into messages (session_id, role, content)
        values (${sessionId}, 'user', 'Hyouka の聖地は？') returning id`,
  );
  const run = await database.execute(
    sql`insert into runs (session_id, message_id, deadline_at, lease_owner, lease_expires_at, payer)
        values (${sessionId}, ${String(onlyRow(message).id)}, now() + interval '100 seconds',
                ${STALE_OWNER}, now() - interval '1 second', 'anon')
        returning id`,
  );
  return String(onlyRow(run).id);
}

function makeTurn(toolbox: CountingSpotLookup): DurableTurn {
  return new DurableTurn({
    store: new NeonTurnStore(plane.transactions),
    model: makeScriptedTurnModel(),
    ...makeSessionTurnParts(),
    toolbox,
    systemPrompt: "test",
    prices: PRICES,
    emit: () => Promise.resolve(),
    owner: OWNER,
    now: Date.now,
  });
}

async function runRow(runId: string): Promise<Record<string, unknown>> {
  return onlyRow(await plane.database.execute(
    sql`select status, lease_owner, failure_reason from runs where id = ${runId}`,
  ));
}

async function stepRows(runId: string): Promise<unknown[]> {
  const rows = await plane.database.execute(
    sql`select step_index, tool_name, result is not null as settled
        from run_steps where run_id = ${runId} order by step_index`,
  );
  return rows.rows;
}

async function toolCallRows(runId: string): Promise<unknown[]> {
  const rows = await plane.database.execute(
    sql`select response_data ->> 'step_index' as step_index
        from messages
        where session_id = ${SESSION} and role = 'assistant'
          and response_data ->> 'run_id' = ${runId}
        order by created_at`,
  );
  return rows.rows;
}

/**
 * The crash injected as the database refusing the INSERT, which is what a step
 * write failing IS. A trigger rather than a dropped table so the run's own
 * SELECTs still answer: this must break the write and nothing else, and the
 * assistant tool-call message must roll back with it because they share one
 * transaction.
 */
async function refuseStepWrites(): Promise<void> {
  await plane.database.execute(sql`create or replace function reject_run_step()
    returns trigger language plpgsql as $$ begin raise exception 'connection reset'; end; $$`);
  await plane.database.execute(sql`create trigger reject_run_steps before insert on run_steps
    for each row execute function reject_run_step()`);
}

async function allowStepWrites(): Promise<void> {
  await plane.database.execute(sql`drop trigger reject_run_steps on run_steps`);
}

void test("a stranded run is reclaimed by a new owner and driven to succeeded", async () => {
  const runId = await seedStrandedRun(plane.database, SESSION);
  const toolbox = new CountingSpotLookup();
  assert.deepEqual(await makeTurn(toolbox).run(runId), { phase: "succeeded" });
  assert.equal(toolbox.calls, 1);
  assert.deepEqual(await runRow(runId), {
    status: "succeeded",
    lease_owner: null,
    failure_reason: null,
  });
  assert.deepEqual(await stepRows(runId), [{ step_index: 0, tool_name: "lookup_spot", settled: true }]);
});

void test("a run another incarnation still holds is left to that owner", async () => {
  const runId = await seedStrandedRun(plane.database, "session-w13-held");
  await plane.database.execute(
    sql`update runs set lease_expires_at = now() + interval '30 seconds' where id = ${runId}`,
  );
  const toolbox = new CountingSpotLookup();
  assert.deepEqual(await makeTurn(toolbox).run(runId), { phase: "declined" });
  assert.equal(toolbox.calls, 0);
  assert.deepEqual(await runRow(runId), {
    status: "running",
    lease_owner: STALE_OWNER,
    failure_reason: null,
  });
});

void test("a step row that already carries a result is replayed, not executed", async () => {
  const runId = await seedStrandedRun(plane.database, "session-w13-replay");
  await plane.database.execute(
    sql`insert into run_steps (run_id, step_index, tool_name, input, result, finished_at)
        values (${runId}, 0, 'lookup_spot', '{"title":"Hyouka"}'::jsonb,
                '{"content":[{"type":"text","text":"cached"}],"details":null}'::jsonb, now())`,
  );
  const toolbox = new CountingSpotLookup();
  assert.deepEqual(await makeTurn(toolbox).run(runId), { phase: "succeeded" });
  assert.equal(toolbox.calls, 0, "the settled step must not reach the tool again");
  assert.deepEqual(await stepRows(runId), [{ step_index: 0, tool_name: "lookup_spot", settled: true }]);
});

void test("a crash before the step row lands replays onto the same step_index", async () => {
  const runId = await seedStrandedRun(plane.database, SESSION);
  const toolbox = new CountingSpotLookup();
  const crashing = makeTurn(toolbox);
  await refuseStepWrites();
  await assert.rejects(() => crashing.run(runId), { name: "TurnStoreUnavailable" });
  await allowStepWrites();
  assert.equal(toolbox.calls, 1);
  assert.equal((await runRow(runId)).status, "running");
  assert.deepEqual(await stepRows(runId), []);
  assert.deepEqual(await toolCallRows(runId), []);

  assert.deepEqual(await makeTurn(toolbox).run(runId), { phase: "succeeded" });
  assert.equal(toolbox.calls, 2, "the unpersisted step runs exactly once more");
  assert.deepEqual(await stepRows(runId), [{ step_index: 0, tool_name: "lookup_spot", settled: true }]);
  assert.deepEqual(await toolCallRows(runId), [{ step_index: "0" }]);
});
