import assert from "node:assert/strict";
import { test } from "node:test";
import { operationResult } from "@earendil-works/pi-agent-core/harness/session";
import { HarnessFault } from "@earendil-works/pi-agent-core";
import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import { reconcileModelAdmission } from "../src/agent/admission/reconcile-model-admission.ts";
import { persistPermanentRejection } from "../src/agent/admission/permanent-rejection.ts";
import { database, SESSION_ID, IDENTITY, NOW, quotaCount } from "./postgres.ts";
import { nativeHarness, reattachNative, context } from "./harness.ts";
import { loseNextCommit } from "./lost-response.ts";

const request = { sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon", locale: "ja", clientMessageId: "first", text: "Find a place" } as const;
const options = { anonymousAllowance: 1, now: NOW };

void test("a failed native result query keeps the admission and quota pending until a later successful witness", async () => {
  let native = await nativeHarness();
  try {
    loseNextCommit(native.session);
    await assert.rejects(admitModelRequest(database, native.lane, context, request, options), samePublicHarnessFault);
    const row = await database.orm.public.AgentAdmission.first();
    assert.ok(row?.operationId);
    native = await reattachNative(native);
    const getValue = native.session.getValue.bind(native.session);
    const terminal = operationResult(row.operationId);
    native.session.getValue = (address, current) => {
      if (address.namespace === terminal.namespace && address.key === terminal.key) throw new Error("Injected result read failure");
      return getValue(address, current);
    };
    const operation = { sessionId: SESSION_ID, operationId: row.operationId };
    await assert.rejects(reconcileModelAdmission(database, native.lane, context, operation, NOW));
    assert.equal((await database.orm.public.AgentAdmission.first())?.state, "pending");
    assert.equal((await database.orm.public.AgentSettlement.all()).length, 0);
    assert.equal(await quotaCount(), 1);
    native.session.getValue = getValue;
    assert.equal((await reconcileModelAdmission(database, native.lane, context, operation, NOW)).kind, "running");
    const driven = await native.lane.drive({ operationId: row.operationId }, context);
    assert.equal(driven.ok && driven.value.kind, "settled");
    assert.equal((await native.lane.getResult(row.operationId, context))?.status, "completed");
    const recovered = await database.orm.public.AgentAdmission.first();
    assert.equal(recovered?.rejectionReason, null);
    assert.equal(recovered.quotaRefundedAt, null);
    assert.equal(await quotaCount(), 1);
  } finally { await native.close(); }
});

void test("the persisted business reason routes the same native HarnessFault to cancellation", async () => {
  let native = await nativeHarness();
  try {
    const accepted = await admitModelRequest(database, native.lane, context, request, options);
    assert.ok(accepted.operationId);
    const operation = { sessionId: SESSION_ID, operationId: accepted.operationId };
    native.harness.hooks.on("before_drive", async () => {
      await persistPermanentRejection(database, operation, "authorization_revoked");
      throw new Error("Injected commit uncertainty");
    });
    await assert.rejects(native.lane.drive({ operationId: accepted.operationId }, context), samePublicHarnessFault);
    native = await reattachNative(native);
    assert.equal((await reconcileModelAdmission(database, native.lane, context, operation, NOW)).kind, "abort");
    assert.equal((await native.lane.requestAbort(accepted.operationId, context)).ok, true);
    const cancelled = await native.lane.drive({ operationId: accepted.operationId }, context);
    assert.equal(cancelled.ok && cancelled.value.kind, "settled");
    const terminal = await native.lane.getResult(accepted.operationId, context);
    assert.equal(terminal?.status, "aborted");
    assert.equal((await database.orm.public.AgentAdmission.first())?.rejectionReason, "authorization_revoked");
    assert.equal((await database.orm.public.AgentSettlement.first())?.settledAt, null);
    assert.equal(await quotaCount(), 1);
  } finally { await native.close(); }
});

/** Both distinct causes cross the same public SDK fault boundary; business state distinguishes them. */
function samePublicHarnessFault(error: unknown) {
  assert.ok(error instanceof HarnessFault);
  assert.equal(error.name, "HarnessFault");
  assert.equal(error.message, "AgentHarness storage or invariant fault");
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.message, "Injected commit uncertainty");
  return true;
}
