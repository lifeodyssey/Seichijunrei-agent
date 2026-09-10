import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { insertUsage } from "@earendil-works/pi-agent-core/harness/session";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { settleModelOperation } from "../src/agent/settlement/native-settlement.ts";
import { acceptOperation, dailyUsage, SETTLED_AT, settlementHarness } from "./settlement-harness.ts";
import { db } from "./settlement-fixture.ts";

const translation: AgentHarnessTool<object | undefined> = { name: "translate_anime_title", label: "Translate", description: "Native test tool", replay: "never", parameters: Type.Object({}),
  execute: () => Promise.resolve({ content: [{ type: "text", text: "translated" }], details: { payer: "platform" }, usage: {
    input: 4, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 9, cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0, total: 0.4 } } }) };

void test("native tool usage charges the server translation separately from a caller-keyed operation", async (test) => {
  const { session, lane } = await settlementHarness(test, [fauxAssistantMessage(fauxToolCall("translate_anime_title", {}), { stopReason: "toolUse" }), fauxAssistantMessage("done")], [translation]);
  await acceptOperation(session, lane, "translation", "byok");
  assert.equal((await lane.drive({ operationId: "translation", waitForRetry: false }, context)).ok, true);
  await settleModelOperation(db, session, lane, "translation", context, SETTLED_AT);
  const rows = await dailyUsage();
  assert.equal(rows[0]?.scope, "byok");
  assert.equal(rows[0].cost_usd, "0.000000");
  assert.deepEqual(rows[1], { scope: "platform", requests: 1, input_tokens: 4, output_tokens: 5, cost_usd: "0.400000" });
});

void test("more than one native ledger page includes entryless adjustments without adding model requests", async (test) => {
  const { session, lane } = await settlementHarness(test, [fauxAssistantMessage("done")]);
  await acceptOperation(session, lane, "adjustments");
  await session.mutate((tx) => tx.commit(Array.from({ length: 51 }, (_, index) => insertUsage({ id: `adjustment-${String(index)}`, adjustment: true,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00000049 } } })), context), context);
  await lane.drive({ operationId: "adjustments", waitForRetry: false }, context);
  await settleModelOperation(db, session, lane, "adjustments", context, SETTLED_AT);
  await settleModelOperation(db, session, lane, "adjustments", context, SETTLED_AT);
  const row = (await dailyUsage())[0];
  assert.equal(row?.requests, 1);
  assert.equal(row.cost_usd, "0.000025");
});
