import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { SELECTION_ENTRY } from "@animichi/agent/selection-entry";
import { projectPilgrimage } from "@animichi/agent/tools";
import { submitSelection, reconcileSelectionIntent } from "../src/agent/selection/native-selection.ts";
import { database, pool } from "./postgres.ts";
import { attach, fixture } from "./harness.ts";
import { atSelectionCommit } from "./faults.ts";

void test("commit-response loss and a failed first reopen retain the obligation and claim the same entry", async () => {
  const f = await fixture();
  atSelectionCommit(f.session, "after", () => Promise.reject(new Error("Lost committed response")));
  await assert.rejects(submitSelection(database, f.lane, context, f.request, f.catalog));
  await assert.rejects(f.lane.findEntries(undefined, context));
  const admission = await database.orm.public.AgentAdmission.where({ clientMessageId: "pick-1" }).first();
  assert.ok(admission);
  assert.equal(admission.state, "pending");
  await f.harness.close(context);
  await pool.query("ALTER TABLE pi_sessions RENAME TO pi_sessions_unavailable");
  try { await assert.rejects(f.repo.open(f.session.metadata, context)); }
  finally { await pool.query("ALTER TABLE pi_sessions_unavailable RENAME TO pi_sessions"); }
  assert.equal((await database.orm.public.AgentAdmission.where({ id: admission.id }).first())?.state, "pending");
  const session = await f.repo.open(f.session.metadata, context), attached = await attach(session, f.fetch);
  const result = await reconcileSelectionIntent(database, attached.lane, context, admission, attached.catalog);
  assert.equal(result.kind, "settled");
  assert.equal(f.calls.length, 1);
  const entries = await attached.lane.findEntries(undefined, context);
  assert.equal(entries.filter((entry) => entry.customType === SELECTION_ENTRY).length, 1);
  assert.equal(projectPilgrimage(entries).clarification, undefined);
  assert.equal((await attached.lane.inspectExecution(context)).current, null);
  await attached.harness.close(context);
});

void test("a crash after read-only domain execution recovers from stored input without a client retry", async () => {
  const f = await fixture();
  atSelectionCommit(f.session, "before", () => Promise.reject(new Error("Crash before result commit")));
  await assert.rejects(submitSelection(database, f.lane, context, f.request, f.catalog));
  const admission = await database.orm.public.AgentAdmission.where({ clientMessageId: "pick-1" }).first();
  assert.ok(admission);
  assert.equal(f.calls.length, 1);
  await f.harness.close(context);
  const session = await f.repo.open(f.session.metadata, context), attached = await attach(session, f.fetch);
  assert.equal((await reconcileSelectionIntent(database, attached.lane, context, admission, attached.catalog)).kind, "settled");
  assert.equal(f.calls.length, 2);
  assert.equal((await attached.lane.findEntries({ customType: SELECTION_ENTRY }, context)).length, 1);
  await attached.harness.close(context);
});

void test("a business failure after the result and clarification projection cannot append another result", async () => {
  const f = await fixture();
  atSelectionCommit(f.session, "after", async () => { await pool.query("ALTER TABLE agent_admissions RENAME TO agent_admissions_unavailable"); });
  try { await assert.rejects(submitSelection(database, f.lane, context, f.request, f.catalog)); }
  finally { await pool.query("ALTER TABLE agent_admissions_unavailable RENAME TO agent_admissions"); }
  assert.equal(projectPilgrimage(await f.lane.findEntries(undefined, context)).clarification, undefined);
  const admission = await database.orm.public.AgentAdmission.where({ clientMessageId: "pick-1" }).first();
  assert.ok(admission);
  assert.equal(admission.state, "pending");
  assert.equal((await reconcileSelectionIntent(database, f.lane, context, admission, f.catalog)).kind, "settled");
  assert.equal(f.calls.length, 1);
  assert.equal((await f.lane.findEntries({ customType: SELECTION_ENTRY }, context)).length, 1);
  await f.harness.close(context);
});
