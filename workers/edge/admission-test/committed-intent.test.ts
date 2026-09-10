import assert from "node:assert/strict";
import { test } from "node:test";
import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import { reconcileModelAdmission } from "../src/agent/admission/reconcile-model-admission.ts";
import { database, SESSION_ID, IDENTITY, NOW, quotaCount } from "./postgres.ts";
import { context } from "./harness.ts";
import { openPersistent } from "./persistent-harness.ts";
import { loseCommittedAcknowledgement } from "./committed-ack.ts";

const request = { sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon", locale: "ja", clientMessageId: "first", text: "Find a place" } as const;
const options = { anonymousAllowance: 1, now: NOW };

void test("lost committed intent acknowledgement reopens as proven unaccepted without phantom quota", async () => {
  let native = await openPersistent();
  const fault = loseCommittedAcknowledgement(database, async () => {
    const row = await database.orm.public.AgentAdmission.first();
    return row?.state === "pending" && row.quotaReservedAt === null;
  });
  try {
    await assert.rejects(admitModelRequest(database, native.lane, context, request, options), /acknowledgement loss/);
    fault.restore();
    assert.equal(fault.didLose(), true);
    const row = await database.orm.public.AgentAdmission.first();
    assert.ok(row?.operationId);
    assert.equal(await quotaCount(), 0);
    assert.equal((await native.lane.inspectExecution(context)).current, null);
    await native.harness.close(context);
    native = await openPersistent();
    const operation = { sessionId: SESSION_ID, operationId: row.operationId };
    assert.equal((await reconcileModelAdmission(database, native.lane, context, operation, NOW)).kind, "void");
    assert.equal((await reconcileModelAdmission(database, native.lane, context, operation, NOW)).kind, "void");
    assert.equal((await database.orm.public.AgentAdmission.first())?.quotaRefundedAt, null);
    assert.equal(await quotaCount(), 0);
    assert.deepEqual(await database.orm.public.AgentOpenOperation.all(), []);
    assert.deepEqual(await database.orm.public.AgentSettlement.all(), []);
  } finally { fault.restore(); await native.harness.close(context); }
});

void test("lost committed reservation acknowledgement is refunded once after current native absence", async () => {
  let native = await openPersistent();
  const fault = loseCommittedAcknowledgement(database, async () => {
    const row = await database.orm.public.AgentAdmission.first();
    return row?.state === "pending" && row.quotaReservedAt !== null;
  });
  try {
    await assert.rejects(admitModelRequest(database, native.lane, context, request, options), /acknowledgement loss/);
    fault.restore();
    assert.equal(fault.didLose(), true);
    const row = await database.orm.public.AgentAdmission.first();
    assert.ok(row?.operationId);
    assert.equal(await quotaCount(), 1);
    assert.equal((await native.lane.inspectExecution(context)).current, null);
    await native.harness.close(context);
    native = await openPersistent();
    const operation = { sessionId: SESSION_ID, operationId: row.operationId };
    assert.equal((await reconcileModelAdmission(database, native.lane, context, operation, NOW)).kind, "void");
    const refunded = await database.orm.public.AgentAdmission.first();
    assert.ok(refunded?.quotaRefundedAt);
    assert.equal(await quotaCount(), 0);
    assert.equal((await reconcileModelAdmission(database, native.lane, context, operation, NOW + 1)).kind, "void");
    assert.deepEqual(await database.orm.public.AgentAdmission.first(), refunded);
    assert.equal(await quotaCount(), 0);
    assert.deepEqual(await database.orm.public.AgentOpenOperation.all(), []);
    assert.deepEqual(await database.orm.public.AgentSettlement.all(), []);
  } finally { fault.restore(); await native.harness.close(context); }
});
