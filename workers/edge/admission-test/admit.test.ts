import assert from "node:assert/strict";
import { test } from "node:test";
import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import { database, pool, SESSION_ID, IDENTITY, NOW, DAY, quotaCount } from "./postgres.ts";
import { nativeHarness, context } from "./harness.ts";

const request = { sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon", locale: "ja", clientMessageId: "first", text: "Find an anime place" } as const;
const options = { anonymousAllowance: 1, now: NOW };

void test("quota refusal leaves the actual native lane healthy for the next legitimate request", async () => {
  const native = await nativeHarness();
  try {
    await pool.query("INSERT INTO anon_daily_message_count (usage_date, anon_id, message_count) VALUES ($1, $2, 1)", [DAY, IDENTITY]);
    const refused = await admitModelRequest(database, native.lane, context, request, options);
    assert.ok(refused.operationId);
    let refusalFault: unknown;
    const refusedDrive = await native.lane.drive({ operationId: refused.operationId }, context).catch((error: unknown) => { refusalFault = error; });
    await assert.doesNotReject(async () => {
      const accepted = await admitModelRequest(database, native.lane, context, { ...request, clientMessageId: "second", payer: "byok" }, options);
      assert.equal(accepted.kind, "accepted");
      assert.ok(accepted.operationId);
      const driven = await native.lane.drive({ operationId: accepted.operationId }, context);
      assert.equal(driven.ok && driven.value.kind, "settled");
      assert.equal((await native.lane.getResult(accepted.operationId, context))?.status, "completed");
      const watch = await native.lane.watch(context);
      assert.equal(watch.snapshot.faulted, false);
      watch.unsubscribe();
    }, "Normal quota refusal must leave the same native lane executable for the next legitimate request");
    assert.equal(refused.kind, "rejected");
    assert.equal(refusalFault, undefined);
    assert.ok(refusedDrive && !refusedDrive.ok);
    assert.equal((await native.lane.inspectExecution(context)).current, null);
    assert.equal(await quotaCount(), 1);
  } finally { await native.close(); }
});

void test("same-key lost acknowledgement reuses one operation and one reservation", async () => {
  const native = await nativeHarness();
  try {
    const original = await admitModelRequest(database, native.lane, context, request, options);
    const replay = await admitModelRequest(database, native.lane, context, request, options);
    assert.equal(replay.kind, "replayed");
    assert.equal(replay.operationId, original.operationId);
    assert.equal(await quotaCount(), 1);
    assert.equal((await database.orm.public.AgentAdmission.all()).length, 1);
    assert.equal((await database.orm.public.AgentSettlement.all()).length, 1);
  } finally { await native.close(); }
});

void test("a reused client key cannot change its request or payer", async () => {
  const native = await nativeHarness();
  try {
    await admitModelRequest(database, native.lane, context, request, options);
    const conflict = await admitModelRequest(database, native.lane, context, { ...request, text: "Different intent" }, options);
    assert.equal(conflict.kind, "conflict");
    assert.equal(await quotaCount(), 1);
  } finally { await native.close(); }
});

void test("another identity cannot take over the existing conversation", async () => {
  const native = await nativeHarness();
  try {
    await pool.query("INSERT INTO sessions (id, user_id) VALUES ($1, 'someone-else')", [SESSION_ID]);
    assert.equal((await admitModelRequest(database, native.lane, context, request, options)).kind, "forbidden");
    assert.equal((await database.orm.public.AgentAdmission.all()).length, 0);
    assert.equal(await quotaCount(), 0);
    assert.equal((await native.lane.inspectExecution(context)).current, null);
  } finally { await native.close(); }
});

void test("an unreconciled selection prevents a conflicting model admission", async () => {
  const native = await nativeHarness();
  try {
    await database.orm.public.AgentAdmission.create({ sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon",
      kind: "selection", selectionRequest: { of: "points", pointIds: ["point"], origin: null, locale: "en" }, clientMessageId: "selection", requestDigest: "existing-selection" });
    assert.equal((await admitModelRequest(database, native.lane, context, request, options)).kind, "blocked");
    assert.equal(await quotaCount(), 0);
    assert.equal((await native.lane.inspectExecution(context)).current, null);
  } finally { await native.close(); }
});

void test("a failed reservation leaves its previously committed intent discoverable", async () => {
  const native = await nativeHarness();
  await pool.query("ALTER TABLE anon_daily_message_count ADD CONSTRAINT admission_test_reservation_fault CHECK (message_count = 0)");
  try {
    await assert.rejects(admitModelRequest(database, native.lane, context, request, options));
    const row = await database.orm.public.AgentAdmission.first();
    assert.equal(row?.state, "pending");
    assert.equal(row.quotaReservedAt, null);
    assert.ok(row.operationId);
    assert.equal((await native.lane.inspectExecution(context)).current, null);
  } finally {
    await pool.query("ALTER TABLE anon_daily_message_count DROP CONSTRAINT admission_test_reservation_fault");
    await native.close();
  }
});

void test("concurrent deliveries of the same request key reserve only once", async () => {
  const native = await nativeHarness();
  try {
    const receipts = await Promise.all([
      admitModelRequest(database, native.lane, context, request, options),
      admitModelRequest(database, native.lane, context, request, options),
    ]);
    assert.equal(new Set(receipts.map((receipt) => receipt.operationId)).size, 1);
    assert.ok(receipts[0].operationId);
    assert.equal((await native.lane.inspectExecution(context)).current?.id, receipts[0].operationId);
    assert.equal(await quotaCount(), 1);
    assert.equal((await database.orm.public.AgentAdmission.all()).length, 1);
  } finally { await native.close(); }
});
