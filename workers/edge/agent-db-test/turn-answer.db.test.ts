/**
 * W1-7b (#1283) against real PostgreSQL: the answer a turn commits, and the
 * answer a returning client reads back.
 *
 * Only a database can answer this one. The part is written into a `jsonb`
 * column by one statement and published by a completely different one — the
 * settlement's INSERT and the retrieval's SELECT never meet in code — so "the
 * intent survives the round trip" is a claim about the column, the driver's
 * `jsonb` handling and the two statements agreeing, not about a projection.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { ANSWER_TOOL_NAME } from "@animichi/contract/agent-tool-schemas";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { NeonTurnStore } from "../src/agent/session/neon-turn-store.ts";
import { readConversationOn } from "../src/agent/retrieval/neon-conversation-records.ts";
import { turnToolbox } from "../src/agent/session/session-turn.ts";
import { TurnCatalogSession } from "../src/agent/session/turn-catalog-session.ts";
import { makeScriptedTurnModel, makeSessionTurnParts } from "../test/doubles/make-turn-parts.ts";
import { makeSequencedToolCallsStreamFn } from "../test/doubles/pi-provider-double.ts";
import { onlyRow, seedRun, seedSession, type AgentArmDatabase } from "./agent-rows.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";

const OWNER_ID = "neon-subject-answer";
const MESSAGE = "聖地巡礼のお手伝いをします。";

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: SETUP_HOOK_TIMEOUT_MS });
after(() => plane.stop(), { timeout: 60_000 });

/** A running run on a session this identity owns, ready for its alarm. */
async function seedOwnedRun(database: AgentArmDatabase, sessionId: string): Promise<string> {
  await seedSession(database, sessionId, OWNER_ID);
  return await seedRun(database, { sessionId, status: "running", leaseExpiresAt: null });
}

/** One session driven to a committed answer, which is what both cases read. */
async function answeredSession(sessionId: string): Promise<void> {
  const runId = await seedOwnedRun(plane.database, sessionId);
  assert.deepEqual(await greetingTurn().run(runId), { phase: "succeeded" });
}

/** One turn whose model answers with `respond` and calls nothing else. */
function greetingTurn(): DurableTurn {
  const session = new TurnCatalogSession({ runId: "run-answer", locale: "ja" });
  const model = makeScriptedTurnModel(makeSequencedToolCallsStreamFn([
    { name: ANSWER_TOOL_NAME, arguments: { kind: "greeting", message: MESSAGE } },
  ]));
  return new DurableTurn({
    store: new NeonTurnStore(plane.transactions),
    model,
    toolbox: turnToolbox({}, session, model),
    ...makeSessionTurnParts(session),
    systemPrompt: "test",
    prices: { inputUsdPerMtok: 0, outputUsdPerMtok: 0 },
    emit: () => Promise.resolve(),
    owner: "do-incarnation-2",
    now: Date.now,
  });
}

async function assistantRow(sessionId: string): Promise<Record<string, unknown>> {
  return onlyRow(await plane.database.execute(
    sql`select content, response_data ->> 'intent' as intent, response_data ->> 'status' as status
        from messages where session_id = ${sessionId} and role = 'assistant'`,
  ));
}

void test("the assistant row commits the answer's part alongside its prose", async () => {
  const sessionId = "session-w17b-committed";
  await answeredSession(sessionId);
  assert.deepEqual(await assistantRow(sessionId), {
    content: MESSAGE,
    intent: "greet_user",
    status: "info",
  });
});

void test("a client that comes back later is published the same intent", async () => {
  const sessionId = "session-w17b-reread";
  await answeredSession(sessionId);
  const page = await readConversationOn(plane.transactions, { sessionId, identityId: OWNER_ID });
  assert.ok(page);
  assert.deepEqual(page.messages.map((message) => message.content), ["seeded", MESSAGE]);
  assert.deepEqual(page.messages.map((message) => message.response_data), [
    null,
    { intent: "greet_user", success: true },
  ]);
});
