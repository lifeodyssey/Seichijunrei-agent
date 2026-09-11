import assert from "node:assert/strict";
import { test } from "node:test";
import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import { reconcileModelAdmission } from "../src/agent/admission/reconcile-model-admission.ts";
import { database, pool, SESSION_ID, IDENTITY, NOW, quotaCount } from "./postgres.ts";
import { nativeHarness, reattachNative, context } from "./harness.ts";
import { loseNextCommit } from "./lost-response.ts";

void test("recovery preserves pending obligations without resurrecting a deleted conversation", async () => {
  let native = await nativeHarness();
  try {
    loseNextCommit(native.session);
    await assert.rejects(admitModelRequest(database, native.lane, context,
      { sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon", locale: "ja", clientMessageId: "deleted", text: "Find a place" },
      { anonymousAllowance: 1, now: NOW }));
    const row = await database.orm.public.AgentAdmission.first();
    assert.ok(row?.operationId);
    await pool.query("DELETE FROM sessions WHERE id = $1", [SESSION_ID]);
    native = await reattachNative(native);
    await assert.rejects(reconcileModelAdmission(database, native.lane, context, { sessionId: SESSION_ID, operationId: row.operationId }, NOW));
    assert.equal((await pool.query("SELECT id FROM sessions WHERE id = $1", [SESSION_ID])).rowCount, 0);
    assert.equal((await database.orm.public.AgentAdmission.first())?.state, "pending");
    assert.equal((await database.orm.public.AgentSettlement.all()).length, 0);
    assert.equal(await quotaCount(), 1);
    assert.equal((await native.lane.inspectExecution(context)).current?.id, row.operationId);
  } finally { await native.close(); }
});
