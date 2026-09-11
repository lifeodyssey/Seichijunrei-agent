import assert from "node:assert/strict";
import { test } from "node:test";
import { NeonStorage } from "@animichi/pi-session-neon";
import { GatingStorage, InstrumentedStorage } from "@earendil-works/pi-agent-core/harness/session/testing";
import { operationMeta, StorageBackedSession } from "@earendil-works/pi-agent-core/harness/session";
import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import { prepareOperationSettlement, settleModelOperation } from "../src/agent/settlement/native-settlement.ts";
import { database, SESSION_ID, IDENTITY, NOW, quotaCount } from "./postgres.ts";
import { context } from "./harness.ts";
import { attachPersistent, openPersistent } from "./persistent-harness.ts";

void test("public storage commit admission follows durable intent and quota and precedes accepted bookkeeping and drive", async () => {
  const gate = new GatingStorage(new NeonStorage(database, { sessionId: SESSION_ID }));
  const storage = new InstrumentedStorage(gate);
  const session = new StorageBackedSession({ id: SESSION_ID, createdAt: NOW, storageVersion: 1 }, storage);
  let native = await attachPersistent(session);
  storage.clearCommitAttempts();
  gate.arm();
  const accepting = admitModelRequest(database, native.lane, context, {
    sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon", locale: "ja", clientMessageId: "ordered", text: "Find a place",
  }, { anonymousAllowance: 1, now: NOW });
  void accepting.catch(() => undefined);
  try {
    await gate.waitPending();
    const intent = await database.orm.public.AgentAdmission.first();
    assert.ok(intent?.operationId);
    assert.equal(intent.state, "pending");
    assert.ok(intent.quotaReservedAt);
    assert.equal(await quotaCount(), 1);
    assert.deepEqual(await database.orm.public.AgentOpenOperation.all(), []);
    assert.deepEqual(await database.orm.public.AgentSettlement.all(), []);
    const address = operationMeta(intent.operationId);
    const attempts = storage.getCommitAttempts();
    assert.equal(attempts.length, 1);
    assert.ok(attempts[0]?.some((write) => write.kind === "value" && write.op === "set" && write.namespace === address.namespace && write.key === address.key));
    assert.equal(await database.orm.public.PiScalarValue.where({ sessionId: SESSION_ID, namespace: address.namespace, key: address.key }).first(), null);
    await gate.next();
    assert.deepEqual(await accepting, { kind: "accepted", operationId: intent.operationId });
    assert.ok(await database.orm.public.PiScalarValue.where({ sessionId: SESSION_ID, namespace: address.namespace, key: address.key }).first());
    assert.equal((await database.orm.public.AgentAdmission.first())?.state, "accepted");
    assert.equal((await database.orm.public.AgentOpenOperation.first())?.operationId, intent.operationId);
    assert.equal((await database.orm.public.AgentSettlement.first())?.settledAt, null);
    await native.harness.close(context);
    native = await openPersistent();
    let drives = 0;
    native.harness.hooks.on("before_drive", async () => {
      drives += 1;
      assert.equal((await database.orm.public.AgentAdmission.first())?.state, "accepted");
      assert.equal((await database.orm.public.AgentOpenOperation.first())?.operationId, intent.operationId);
      assert.equal((await database.orm.public.AgentSettlement.first())?.settledAt, null);
    });
    assert.equal(await prepareOperationSettlement(database, native.session, intent.operationId, context), true);
    const driven = await native.lane.drive({ operationId: intent.operationId }, context);
    assert.equal(driven.ok && driven.value.kind, "settled");
    assert.equal(drives, 1);
    assert.equal((await settleModelOperation(database, native.session, native.lane, intent.operationId, context, NOW))?.status, "completed");
    assert.equal((await database.orm.public.AgentAdmission.first())?.state, "settled");
    assert.deepEqual(await database.orm.public.AgentOpenOperation.all(), []);
    assert.equal(await quotaCount(), 1);
  } finally { gate.discard(); await accepting.catch(() => undefined); await native.harness.close(context); }
});
