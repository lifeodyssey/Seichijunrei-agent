import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { SELECTION_ENTRY } from "@animichi/agent/selection-entry";
import { createCatalogClient } from "@animichi/agent/tools";
import { submitSelection } from "../src/agent/selection/native-selection.ts";
import { database, pool, SESSION_ID } from "./postgres.ts";
import { fixture } from "./harness.ts";

void test("an operation accepted during catalog I/O leaves selection pending without writing to its inbox", async () => {
  const f = await fixture();
  const catalog = createCatalogClient(async () => {
    await f.lane.accept({ kind: "prompt", prompt: "next turn", operationId: "new-operation" }, context);
    return Response.json({ rows: [] });
  });
  assert.deepEqual(await submitSelection(database, f.lane, context, f.request, catalog), { kind: "pending" });
  assert.deepEqual(await f.lane.findEntries({ customType: SELECTION_ENTRY }, context), []);
  assert.equal((await database.orm.public.AgentAdmission.where({ clientMessageId: "pick-1" }).first())?.state, "pending");
  await f.harness.close(context);
});

void test("deleting the conversation during catalog I/O prevents result append and does not recreate ownership", async () => {
  const f = await fixture();
  const catalog = createCatalogClient(async () => {
    await pool.query("DELETE FROM sessions WHERE id = $1", [SESSION_ID]);
    return Response.json({ rows: [] });
  });
  assert.deepEqual(await submitSelection(database, f.lane, context, f.request, catalog), { kind: "forbidden" });
  assert.deepEqual(await f.lane.findEntries({ customType: SELECTION_ENTRY }, context), []);
  assert.equal((await pool.query("SELECT id FROM sessions WHERE id = $1", [SESSION_ID])).rowCount, 0);
  assert.equal((await database.orm.public.AgentAdmission.where({ clientMessageId: "pick-1" }).first())?.state, "pending");
  assert.deepEqual(await submitSelection(database, f.lane, context, f.request, f.catalog), { kind: "forbidden" });
  assert.equal(f.calls.length, 0);
  await f.harness.close(context);
});

void test("a stale clarification remains a durable refusal on retry without calling the catalog", async () => {
  const f = await fixture();
  const request = { ...f.request, selection: { ...f.request.selection, clarificationId: f.request.selection.clarificationId + 1 } };
  const first = await submitSelection(database, f.lane, context, request, f.catalog);
  assert.equal(first.kind, "rejected");
  assert.deepEqual(await submitSelection(database, f.lane, context, request, f.catalog), first);
  assert.equal(f.calls.length, 0);
  assert.equal((await database.orm.public.AgentAdmission.where({ clientMessageId: "pick-1" }).first())?.state, "void");
  assert.deepEqual(await f.lane.findEntries({ customType: SELECTION_ENTRY }, context), []);
  await f.harness.close(context);
});
