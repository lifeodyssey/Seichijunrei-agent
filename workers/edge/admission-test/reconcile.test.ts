import assert from "node:assert/strict";
import { test } from "node:test";
import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import { reconcileModelAdmission } from "../src/agent/admission/reconcile-model-admission.ts";
import { database, pool, SESSION_ID, IDENTITY, NOW, quotaCount } from "./postgres.ts";
import { nativeHarness, reattachNative, context } from "./harness.ts";
import { loseNextCommit, rejectNextCommit, loseTerminalCommit } from "./lost-response.ts";

const request = { sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon", locale: "ja", clientMessageId: "first", text: "Find a place" } as const;
const options = { anonymousAllowance: 1, now: NOW };

void test("committed-but-thrown native accept retains its reservation and repairs accepted obligations after reattach", async () => {
  let native = await nativeHarness();
  try {
    loseNextCommit(native.session);
    await assert.rejects(admitModelRequest(database, native.lane, context, request, options));
    const row = await database.orm.public.AgentAdmission.first();
    assert.ok(row?.operationId);
    assert.equal(row.state, "pending");
    assert.equal(await quotaCount(), 1);
    native = await reattachNative(native);
    const recovered = await reconcileModelAdmission(database, native.lane, context, { sessionId: SESSION_ID, operationId: row.operationId }, NOW);
    assert.equal(recovered.kind, "running");
    assert.equal((await database.orm.public.AgentAdmission.first())?.state, "accepted");
    assert.equal((await database.orm.public.AgentOpenOperation.first())?.operationId, row.operationId);
    assert.equal((await database.orm.public.AgentSettlement.first())?.settledAt, null);
    assert.equal(await quotaCount(), 1);
    const driven = await native.lane.drive({ operationId: row.operationId }, context);
    assert.equal(driven.ok && driven.value.kind, "settled");
  } finally { await native.close(); }
});

void test("only a successfully reattached absent operation releases the orphan reservation once", async () => {
  let native = await nativeHarness();
  try {
    rejectNextCommit(native.session);
    await assert.rejects(admitModelRequest(database, native.lane, context, request, options));
    const row = await database.orm.public.AgentAdmission.first();
    assert.ok(row?.operationId);
    assert.equal(await quotaCount(), 1);
    assert.equal((await admitModelRequest(database, native.lane, context, { ...request, clientMessageId: "conflicting" }, options)).kind, "blocked");
    native = await reattachNative(native);
    const operation = { sessionId: SESSION_ID, operationId: row.operationId };
    assert.equal((await reconcileModelAdmission(database, native.lane, context, operation, NOW)).kind, "void");
    assert.equal((await reconcileModelAdmission(database, native.lane, context, operation, NOW)).kind, "void");
    assert.equal(await quotaCount(), 0);
    assert.ok((await database.orm.public.AgentAdmission.first())?.quotaRefundedAt);
  } finally { await native.close(); }
});

void test("business commit after successful SDK accept is repaired without voiding or refunding", async () => {
  const native = await nativeHarness();
  await pool.query("ALTER TABLE agent_settlements ADD CONSTRAINT admission_test_obligation_fault CHECK (false)");
  try {
    await assert.rejects(admitModelRequest(database, native.lane, context, request, options));
    await pool.query("ALTER TABLE agent_settlements DROP CONSTRAINT admission_test_obligation_fault");
    const row = await database.orm.public.AgentAdmission.first();
    assert.ok(row?.operationId);
    assert.equal(row.state, "pending");
    assert.equal((await native.lane.inspectExecution(context)).current?.id, row.operationId);
    assert.equal((await reconcileModelAdmission(database, native.lane, context, { sessionId: SESSION_ID, operationId: row.operationId }, NOW)).kind, "running");
    assert.equal((await database.orm.public.AgentSettlement.all()).length, 1);
    assert.equal(await quotaCount(), 1);
  } finally {
    await pool.query("ALTER TABLE agent_settlements DROP CONSTRAINT IF EXISTS admission_test_obligation_fault");
    await native.close();
  }
});

void test("lost terminal commit response preserves the actual immutable result for settlement", async () => {
  let native = await nativeHarness();
  try {
    const accepted = await admitModelRequest(database, native.lane, context, request, options);
    assert.ok(accepted.operationId);
    loseTerminalCommit(native.session, accepted.operationId);
    await assert.rejects(native.lane.drive({ operationId: accepted.operationId }, context));
    native = await reattachNative(native);
    const recovered = await reconcileModelAdmission(database, native.lane, context, { sessionId: SESSION_ID, operationId: accepted.operationId }, NOW);
    assert.equal(recovered.kind, "terminal");
    assert.equal(recovered.result.status, "completed");
    assert.equal(await quotaCount(), 1);
    assert.equal((await database.orm.public.AgentSettlement.first())?.settledAt, null);
  } finally { await native.close(); }
});

void test("an accepted obligation with absent native history remains pending instead of being refunded", async () => {
  const original = await nativeHarness();
  const empty = await nativeHarness();
  try {
    const accepted = await admitModelRequest(database, original.lane, context, request, options);
    assert.ok(accepted.operationId);
    const outcome = await reconcileModelAdmission(database, empty.lane, context, { sessionId: SESSION_ID, operationId: accepted.operationId }, NOW);
    assert.equal(outcome.kind, "pending");
    assert.equal((await database.orm.public.AgentAdmission.first())?.state, "accepted");
    assert.equal(await quotaCount(), 1);
  } finally { await original.close(); await empty.close(); }
});
