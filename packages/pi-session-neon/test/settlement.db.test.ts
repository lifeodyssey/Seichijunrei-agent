import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptedReservation, businessBalances, insertAdmission } from "./business-records.ts";
import { settle } from "./business-transactions.ts";
import { database, pool } from "./postgres.ts";

const RESERVED_BALANCES = [
  [{ operationId: "operation", lastUsageSeq: -1, settledAt: null }],
  [], [{ count: "1" }], [{ state: "accepted", quotaRefundedAt: null }],
];

void test("an unsettled obligation remains discoverable without an open-operation row", async () => {
  await acceptedReservation();
  await database.orm.public.AgentOpenOperation.where((row) => row.operationId.eq("operation")).delete();
  const rows = await database.orm.public.AgentSettlement.where((row) => row.settledAt.isNull()).select("operationId").all();
  assert.deepEqual(rows, [{ operationId: "operation" }]);
});

void test("replaying settlement advances the cursor, cost and refund exactly once", async () => {
  await acceptedReservation();
  await database.runtime().execute(settle());
  await database.runtime().execute(settle());
  assert.deepEqual(await businessBalances(), [
    [{ operationId: "operation", lastUsageSeq: 4, settledAt: "2026-09-09 00:00:00+00" }],
    [{ requests: "1", cost: "0.300000" }], [{ count: "0" }],
    [{ state: "settled", quotaRefundedAt: "2026-09-09 00:00:00+00" }],
  ]);
});

void test("failed settlement rolls back its ledger cursor, charge and refund marker", async () => {
  await acceptedReservation();
  await assert.rejects(database.transaction(async (tx) => {
    await tx.execute(settle());
    throw new Error("settlement interrupted");
  }), /settlement interrupted/);
  assert.deepEqual(await businessBalances(), RESERVED_BALANCES);
});

void test("duplicate settlement and discovery keys cannot create another obligation", async () => {
  await acceptedReservation();
  await assert.rejects(pool.query("INSERT INTO agent_settlements (operation_id) VALUES ('operation')"), { code: "23505" });
  await assert.rejects(pool.query("INSERT INTO agent_open_operations (operation_id) VALUES ('operation')"), { code: "23505" });
});

void test("business obligations require an admission and a valid initial ledger cursor", async () => {
  await assert.rejects(pool.query("INSERT INTO agent_settlements (operation_id) VALUES ('unknown')"), { code: "23503" });
  await insertAdmission();
  await assert.rejects(pool.query("INSERT INTO agent_settlements (operation_id, last_usage_seq) VALUES ('operation', -2)"), { code: "23514" });
});
