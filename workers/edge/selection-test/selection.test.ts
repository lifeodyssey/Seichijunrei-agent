import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { SELECTION_ENTRY, readSelectionEntry } from "@animichi/agent/selection";
import { submitSelection, reconcileSelectionIntent } from "../src/agent/selection/native-selection.ts";
import { persistSelectionIntent } from "../src/agent/selection/selection-intent.ts";
import { database } from "./postgres.ts";
import { attach, fixture } from "./harness.ts";

void test("a stable key returns one native custom entry and one catalog execution", async () => {
  const f = await fixture();
  const first = await submitSelection(database, f.lane, context, f.request, f.catalog);
  const replay = await submitSelection(database, f.lane, context, f.request, f.catalog);
  assert.equal(first.kind, "settled");
  assert.deepEqual(replay, first);
  assert.equal(f.calls.length, 1);
  const entries = await f.lane.findEntries({ customType: SELECTION_ENTRY }, context);
  assert.equal(entries.length, 1);
  assert.equal(entries[0] && readSelectionEntry(entries[0])?.origin, "server");
  const intent = await database.orm.public.AgentAdmission.where({ clientMessageId: "pick-1" }).first();
  assert.equal(intent?.operationId, null);
  assert.equal(intent.state, "settled");
  await f.harness.close(context);
});

void test("an open native model operation refuses selection before effects or the pending entry inbox", async () => {
  const f = await fixture();
  await f.lane.accept({ kind: "prompt", prompt: "busy", operationId: "busy-operation" }, context);
  assert.deepEqual(await submitSelection(database, f.lane, context, f.request, f.catalog), { kind: "blocked" });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.lane.findEntries({ customType: SELECTION_ENTRY }, context), []);
  assert.equal(await database.orm.public.AgentAdmission.where({ kind: "selection" }).first(), null);
  await f.harness.close(context);
});

void test("a persisted selection input recovers after restart without the client resending its choice", async () => {
  const f = await fixture();
  const intent = await persistSelectionIntent(database, f.request);
  assert.ok("admission" in intent);
  assert.deepEqual(await submitSelection(database, f.lane, context, { ...f.request, clientMessageId: "conflicting" }, f.catalog), { kind: "blocked" });
  await f.harness.close(context);
  const session = await f.repo.open(f.session.metadata, context);
  const attached = await attach(session, f.fetch);
  const result = await reconcileSelectionIntent(database, attached.lane, context, intent.admission, attached.catalog);
  assert.equal(result.kind, "settled");
  assert.equal(f.calls.length, 1);
  assert.equal((await attached.lane.findEntries({ customType: SELECTION_ENTRY }, context)).length, 1);
  await attached.harness.close(context);
});

void test("a reused client key with a different selection is a conflict", async () => {
  const f = await fixture();
  await submitSelection(database, f.lane, context, f.request, f.catalog);
  assert.deepEqual(await submitSelection(database, f.lane, context, { ...f.request, selection: { ...f.request.selection, candidateIds: ["different"] } }, f.catalog), { kind: "conflict" });
  assert.equal(f.calls.length, 1);
  await f.harness.close(context);
});
