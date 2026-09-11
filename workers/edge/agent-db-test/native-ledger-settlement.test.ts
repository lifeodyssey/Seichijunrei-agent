import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { settleModelOperation } from "../src/agent/settlement/native-settlement.ts";
import { acceptOperation, dailyUsage, SETTLED_AT, settlementHarness } from "./settlement-harness.ts";
import { db } from "./settlement-fixture.ts";
import { settlementModels } from "./settlement-models.ts";

void test("a real Neon ledger settles two terminal operations independently and never reprices their recorded calls", async (test) => {
  const { session, lane } = await settlementHarness(test, [], undefined, settlementModels());
  await acceptOperation(session, lane, "first");
  assert.equal((await lane.drive({ operationId: "first", waitForRetry: false }, context)).ok, true);
  await lane.setModel({ provider: "settlement-price", modelId: "second" }, context);
  await acceptOperation(session, lane, "second");
  assert.equal((await lane.drive({ operationId: "second", waitForRetry: false }, context)).ok, true);
  assert.equal((await lane.inspectExecution(context)).current, null);
  await db.orm.public.AgentOpenOperation.where({ operationId: "second" }).deleteAll();
  assert.equal((await settleModelOperation(db, session, lane, "second", context, SETTLED_AT))?.status, "completed");
  assert.deepEqual(await dailyUsage(), [{ scope: "user", requests: 1, input_tokens: 100, output_tokens: 200, cost_usd: "0.000003" }]);
  assert.equal((await settleModelOperation(db, session, lane, "first", context, SETTLED_AT))?.status, "completed");
  assert.equal((await settleModelOperation(db, session, lane, "first", context, SETTLED_AT))?.status, "completed");
  assert.deepEqual(await dailyUsage(), [{ scope: "user", requests: 2, input_tokens: 110, output_tokens: 220, cost_usd: "0.300003" }]);
  assert.equal(await db.orm.public.AgentOpenOperation.where({ operationId: "first" }).first(), null);
});

void test("a terminal operation with no recorded usage origin stays pending", async (test) => {
  const { session, lane } = await settlementHarness(test, [fauxAssistantMessage("done")]);
  await acceptOperation(session, lane, "uncertain");
  await db.orm.public.AgentSettlement.where({ operationId: "uncertain" }).update({ lastUsageSeq: -1 });
  await lane.drive({ operationId: "uncertain", waitForRetry: false }, context);
  assert.equal(await settleModelOperation(db, session, lane, "uncertain", context, SETTLED_AT), undefined);
  assert.equal((await db.orm.public.AgentSettlement.where({ operationId: "uncertain" }).first())?.settledAt, null);
  assert.deepEqual(await dailyUsage(), []);
});
