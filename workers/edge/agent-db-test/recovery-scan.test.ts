import assert from "node:assert/strict";
import { test } from "node:test";
import { closedClient, db, model, selection, session, SESSION } from "./recovery-fixture.ts";
import { scanAdmissionIntents, scanSelectionIntents, scanUnsettledOperations } from "../src/agent/recovery/scan.ts";

void test("recovery finds pending and accepted submissions without an open-operation index", async () => {
  await model("accept-committed-response-lost");
  await model("retry-waiting", "accepted");
  await model("complete", "settled");
  await model("refused", "void");
  await selection("choice");
  const rows = await scanAdmissionIntents(db, SESSION);
  assert.deepEqual(rows.map((row) => row.operationId).sort(), ["accept-committed-response-lost", "retry-waiting"]);
  assert.deepEqual(await db.orm.public.AgentOpenOperation.all(), []);
});

void test("recovery discovers settlement independently of admission and SDK open state", async () => {
  await model("terminal-unsettled", "settled");
  await model("already-accounted", "settled");
  await db.orm.public.AgentSettlement.create({ operationId: "terminal-unsettled" });
  await db.orm.public.AgentSettlement.create({ operationId: "already-accounted", settledAt: "2026-09-10T00:00:00Z" });
  assert.deepEqual(await scanAdmissionIntents(db, SESSION), []);
  assert.deepEqual(await scanUnsettledOperations(db, SESSION), [{ operationId: "terminal-unsettled", lastUsageSeq: -1, settledAt: null }]);
});

void test("unresolved choices have their own scan and do not require a fabricated operation", async () => {
  await selection("pending-choice");
  await selection("committed-choice", "accepted");
  await selection("settled-choice", "settled");
  await model("model-submission");
  const rows = await scanSelectionIntents(db, SESSION);
  assert.deepEqual(rows.map((row) => row.clientMessageId).sort(), ["committed-choice", "pending-choice"]);
  assert.deepEqual(rows.map((row) => row.operationId), [null, null]);
});

void test("a session scan cannot discover another session's admission or settlement", async () => {
  await session("other-session");
  await model("foreign", "accepted", "other-session");
  await db.orm.public.AgentSettlement.create({ operationId: "foreign" });
  assert.deepEqual(await scanAdmissionIntents(db, SESSION), []);
  assert.deepEqual(await scanUnsettledOperations(db, SESSION), []);
});

void test("admission scans stay bounded and continue beyond an unresolved first page", async () => {
  await Promise.all(Array.from({ length: 53 }, (_, i) => model(`request-${String(i)}`)));
  const first = await scanAdmissionIntents(db, SESSION);
  assert.equal(first.length, 50);
  const last = first.at(-1);
  assert.ok(last);
  const second = await scanAdmissionIntents(db, SESSION, last.id);
  assert.equal(second.length, 3);
  assert.equal(new Set([...first, ...second].map((row) => row.id)).size, 53);
});

void test("selection scans continue by native cursor without losing unresolved choices", async () => {
  await Promise.all(Array.from({ length: 53 }, (_, i) => selection(`choice-${String(i)}`)));
  const first = await scanSelectionIntents(db, SESSION);
  assert.equal(first.length, 50);
  const last = first.at(-1);
  assert.ok(last);
  const second = await scanSelectionIntents(db, SESSION, last.id);
  assert.equal(second.length, 3);
  assert.equal(new Set([...first, ...second].map((row) => row.id)).size, 53);
});

void test("unsettled scans continue independently when an earlier page remains unsettled", async () => {
  const names = Array.from({ length: 53 }, (_, i) => `operation-${String(i)}`);
  await Promise.all(names.map((name) => model(name, "settled")));
  await Promise.all(names.map((operationId) => db.orm.public.AgentSettlement.create({ operationId })));
  const first = await scanUnsettledOperations(db, SESSION);
  assert.equal(first.length, 50);
  const last = first.at(-1);
  assert.ok(last);
  const second = await scanUnsettledOperations(db, SESSION, last.operationId);
  assert.equal(second.length, 3);
  assert.equal(new Set([...first, ...second].map((row) => row.operationId)).size, 53);
});

void test("a failed database read remains a failure instead of proof that work is absent", async () => {
  const client = await closedClient();
  await assert.rejects(async () => await scanAdmissionIntents(client, SESSION));
  await assert.rejects(async () => await scanSelectionIntents(client, SESSION));
  await assert.rejects(async () => await scanUnsettledOperations(client, SESSION));
});
