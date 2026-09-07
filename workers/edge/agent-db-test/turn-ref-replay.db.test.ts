/**
 * W1 follow-up (#1279) against real PostgreSQL: the tool session rebuilt from
 * the settled steps of its own run.
 *
 * Only a database can answer this one. What has to survive the crash is the
 * `run_steps.result` jsonb — the ref AND the rows behind it — read back by
 * `loadRunningTurn` on a FRESH session object, which is what a new Durable
 * Object incarnation is. A double could keep the shape; only Postgres can say
 * whether the column really carries it there and back. The assistant tool-call
 * message riding the same transaction is what makes the retry resume at
 * `plan_route` rather than search again, and that too is the schema's promise.
 *
 * The catalog counts its own calls, so "the route was really planned" is
 * measured as "the itinerary procedure was asked", never asserted about a flag.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import { turnToolbox } from "../src/agent/session/session-turn.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import { LUCKY_STAR_ROUTE, SATTE, WASHINOMIYA } from "../test/doubles/catalog-payloads.ts";
import { makeScriptedTurnModel, makeSessionTurnParts } from "../test/doubles/make-turn-parts.ts";
import {
  makeSequencedToolCallsStreamFn,
  type ScriptedToolCall,
} from "../test/doubles/pi-provider-double.ts";
import { onlyRow, seedSession, type AgentArmDatabase } from "./agent-rows.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";

const OWNER = "do-incarnation-2";
const PRICES = { inputUsdPerMtok: 0, outputUsdPerMtok: 0 };
const RUN_ID = "run-ref-replay";
const SEARCH_REF = `search:2:1@${RUN_ID}`;
const SEARCH_CALL: ScriptedToolCall = { name: "search_bangumi", arguments: { bangumi_id: "1" } };
const PLAN_CALL: ScriptedToolCall = {
  name: "plan_route",
  arguments: { search_result_ref: SEARCH_REF },
};

let plane: AgentDataPlane;

before(async () => {
  plane = await startAgentDataPlane();
}, { timeout: SETUP_HOOK_TIMEOUT_MS });

after(async () => {
  await plane.stop();
});

/** A `CATALOG` binding that answers the two procedures this turn reaches, and
 * counts the routes it was asked to plan. */
class CountingCatalogBinding {
  planned = 0;

  fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/catalog/itinerary") {
      return Promise.resolve(Response.json({ rows: [WASHINOMIYA, SATTE], synced_at: null }));
    }
    this.planned += 1;
    return Promise.resolve(Response.json(LUCKY_STAR_ROUTE));
  }
}

/** A `running` run whose lease belongs to an incarnation that is long gone. */
async function seedStrandedRun(database: AgentArmDatabase, sessionId: string): Promise<string> {
  await seedSession(database, sessionId);
  const message = await database.execute(
    sql`insert into messages (session_id, role, content)
        values (${sessionId}, 'user', 'らき☆すたの聖地を回りたい') returning id`,
  );
  const run = await database.execute(
    sql`insert into runs (session_id, message_id, deadline_at, lease_owner, lease_expires_at, payer)
        values (${sessionId}, ${String(onlyRow(message).id)}, now() + interval '100 seconds',
                'do-incarnation-1', now() - interval '1 second', 'anon')
        returning id`,
  );
  return String(onlyRow(run).id);
}

/** One alarm's turn, on its own session object — a fresh incarnation's heap. */
function makeTurn(catalog: CountingCatalogBinding, calls: ScriptedToolCall[]): DurableTurn {
  const session = new TurnCatalogSession({ runId: RUN_ID, locale: "ja" });
  const model = makeScriptedTurnModel(makeSequencedToolCallsStreamFn(calls));
  return new DurableTurn({
    store: new NeonTurnStore(plane.transactions),
    model,
    toolbox: turnToolbox({ CATALOG: catalog }, session, model),
    ...makeSessionTurnParts(session),
    systemPrompt: "test",
    prices: PRICES,
    emit: () => Promise.resolve(),
    owner: OWNER,
    now: Date.now,
  });
}

async function stepRows(runId: string): Promise<unknown[]> {
  const rows = await plane.database.execute(
    sql`select step_index, tool_name, result -> 'details' ->> 'status' as status
        from run_steps where run_id = ${runId} order by step_index`,
  );
  return rows.rows;
}

/** The refs one settled step recorded, as `run_steps.result` holds them. */
async function mintedRefs(runId: string, stepIndex: number): Promise<unknown[]> {
  const rows = await plane.database.execute(
    sql`select jsonb_path_query_array(result, '$.minted[*].ref') as refs
        from run_steps where run_id = ${runId} and step_index = ${stepIndex}`,
  );
  return onlyRow(rows).refs as unknown[];
}

/**
 * The crash: the database refuses every step row from the FIRST one on, so the
 * search settles with its assistant message and the route that follows it does
 * not. Injected as a trigger for the reason `turn-loop.db.test.ts` gives.
 */
async function refuseStepsFrom(stepIndex: number): Promise<void> {
  // The bound literal is written INTO the function body rather than passed as a
  // parameter: inside `$$ … $$` a `$1` placeholder is body text, not a bind slot.
  const guard = sql.raw(`NEW.step_index >= ${String(stepIndex)}`);
  await plane.database.execute(sql`create or replace function reject_run_step()
    returns trigger language plpgsql as $$ begin
      if ${guard} then raise exception 'connection reset'; end if;
      return NEW; end; $$`);
  await plane.database.execute(sql`create trigger reject_run_steps before insert on run_steps
    for each row execute function reject_run_step()`);
}

async function allowStepWrites(): Promise<void> {
  await plane.database.execute(sql`drop trigger reject_run_steps on run_steps`);
}

/** The attempt that settled the search and crashed before the route landed. */
async function crashedAfterSearch(sessionId: string): Promise<string> {
  const runId = await seedStrandedRun(plane.database, sessionId);
  await refuseStepsFrom(1);
  await assert.rejects(makeTurn(new CountingCatalogBinding(), [SEARCH_CALL, PLAN_CALL]).run(runId), {
    name: "TurnStoreUnavailable",
  });
  await allowStepWrites();
  return runId;
}

void test("the crashed attempt leaves the search settled and the route unwritten", async () => {
  const runId = await crashedAfterSearch("session-1279-crash");
  assert.deepEqual(await stepRows(runId), [
    { step_index: 0, tool_name: "search_bangumi", status: null },
  ]);
  assert.deepEqual(await mintedRefs(runId, 0), [SEARCH_REF]);
});

void test("the retry plans the route over the ref the crashed attempt minted", async () => {
  const runId = await crashedAfterSearch("session-1279-retry");
  const catalog = new CountingCatalogBinding();
  assert.deepEqual(await makeTurn(catalog, [PLAN_CALL]).run(runId), { phase: "succeeded" });
  assert.deepEqual(await stepRows(runId), [
    { step_index: 0, tool_name: "search_bangumi", status: null },
    { step_index: 1, tool_name: "plan_route", status: "ok" },
  ]);
  assert.equal(catalog.planned, 1);
});

void test("the route the retry planned is minted under a ref of its own", async () => {
  const runId = await crashedAfterSearch("session-1279-mint");
  await makeTurn(new CountingCatalogBinding(), [PLAN_CALL]).run(runId);
  assert.deepEqual(await mintedRefs(runId, 1), [`route:2:2@${RUN_ID}`]);
});
