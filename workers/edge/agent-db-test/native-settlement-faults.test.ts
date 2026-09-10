import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { settleModelOperation } from "../src/agent/settlement/native-settlement.ts";
import { acceptOperation, dailyUsage, SETTLED_AT, settlementHarness } from "./settlement-harness.ts";
import { db } from "./settlement-fixture.ts";

void test("failure after accounting writes but before business commit rolls every marker and charge back", async (test) => {
  const { session, lane } = await settlementHarness(test, [fauxAssistantMessage("done")]);
  await acceptOperation(session, lane, "rollback");
  const origin = await db.orm.public.AgentSettlement.where({ operationId: "rollback" }).first();
  const openOperation = await db.orm.public.AgentOpenOperation.where({ operationId: "rollback" }).all();
  assert.equal(openOperation.length, 1);
  await lane.drive({ operationId: "rollback", waitForRetry: false }, context);
  const transaction = db.transaction.bind(db);
  const fault = test.mock.method(db, "transaction", async (work: Parameters<typeof db.transaction>[0]) => transaction(async (tx) => {
    await work(tx);
    throw new Error("Injected failure before COMMIT");
  }));
  await assert.rejects(settleModelOperation(db, session, lane, "rollback", context, SETTLED_AT), /before COMMIT/);
  fault.mock.restore();
  assert.deepEqual(await dailyUsage(), []);
  assert.deepEqual(await db.orm.public.AgentSettlement.where({ operationId: "rollback" }).first(), origin);
  assert.deepEqual(await db.orm.public.AgentOpenOperation.where({ operationId: "rollback" }).all(), openOperation);
  assert.equal((await db.orm.public.AgentAdmission.where({ operationId: "rollback" }).first())?.state, "accepted");
  await settleModelOperation(db, session, lane, "rollback", context, SETTLED_AT);
  assert.deepEqual(await db.orm.public.AgentOpenOperation.where({ operationId: "rollback" }).all(), []);
  assert.equal((await dailyUsage())[0]?.requests, 1);
});

void test("lost business COMMIT acknowledgement replays one actual committed settlement", async (test) => {
  const { session, lane } = await settlementHarness(test, [fauxAssistantMessage("done")]);
  await acceptOperation(session, lane, "lost-response");
  await lane.drive({ operationId: "lost-response", waitForRetry: false }, context);
  const transaction = db.transaction.bind(db);
  const fault = test.mock.method(db, "transaction", async (work: Parameters<typeof db.transaction>[0]) => {
    await transaction(work);
    throw new Error("Injected lost COMMIT response");
  });
  await assert.rejects(settleModelOperation(db, session, lane, "lost-response", context, SETTLED_AT), /lost COMMIT response/);
  fault.mock.restore();
  const committed = await db.orm.public.AgentSettlement.where({ operationId: "lost-response" }).first();
  assert.ok(committed?.settledAt);
  await settleModelOperation(db, session, lane, "lost-response", context, SETTLED_AT + 86_400_000);
  assert.deepEqual(await db.orm.public.AgentSettlement.where({ operationId: "lost-response" }).first(), committed);
  assert.equal((await dailyUsage())[0]?.requests, 1);
});

void test("failed native terminal query cannot become missing work or a free execution", async (test) => {
  const { session, lane } = await settlementHarness(test, [fauxAssistantMessage("done")]);
  await acceptOperation(session, lane, "query-failure");
  await lane.drive({ operationId: "query-failure", waitForRetry: false }, context);
  const fault = test.mock.method(lane, "getResult", () => Promise.reject(new Error("Injected unavailable native result")));
  await assert.rejects(settleModelOperation(db, session, lane, "query-failure", context, SETTLED_AT), /unavailable native result/);
  fault.mock.restore();
  assert.equal((await db.orm.public.AgentSettlement.where({ operationId: "query-failure" }).first())?.settledAt, null);
  assert.equal((await db.orm.public.AgentAdmission.where({ operationId: "query-failure" }).first())?.quotaRefundedAt, null);
  assert.deepEqual(await dailyUsage(), []);
});

void test("a real failed ledger query rolls back accounting and leaves its cursor pending", async (test) => {
  const { session, lane } = await settlementHarness(test, [fauxAssistantMessage("done")]);
  await acceptOperation(session, lane, "ledger-failure");
  await lane.drive({ operationId: "ledger-failure", waitForRetry: false }, context);
  const pending = await db.orm.public.AgentSettlement.where({ operationId: "ledger-failure" }).first();
  await db.runtime().execute(db.raw.sql`ALTER TABLE pi_records RENAME TO unavailable_pi_records`.affectedCount().build());
  try {
    await assert.rejects(settleModelOperation(db, session, lane, "ledger-failure", context, SETTLED_AT));
    assert.deepEqual(await db.orm.public.AgentSettlement.where({ operationId: "ledger-failure" }).first(), pending);
    assert.deepEqual(await dailyUsage(), []);
  } finally {
    await db.runtime().execute(db.raw.sql`ALTER TABLE unavailable_pi_records RENAME TO pi_records`.affectedCount().build());
  }
});
