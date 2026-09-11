import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { searchBangumi, readSearchResult } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

void test("native search reserves the result entry id and commits the complete catalog payload", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ rows: [], synced_at: "2026-09-10" })));
  const ids: string[] = [];
  toolContext.reserveToolUsage = (id) => { ids.push(id); return Promise.resolve(); };
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "123" }), { stopReason: "toolUse" }), fauxAssistantMessage("No points.")], [searchBangumi]);
  const lane = await harness.lane("main", BACKGROUND_CONTEXT);
  await lane.prompt("Search", undefined, BACKGROUND_CONTEXT);
  assert.equal(ids.length, 1);
  const ref = ids[0];
  assert.ok(ref);
  const entry = await session.getEntry(ref, BACKGROUND_CONTEXT);
  assert.equal(entry?.type, "message");
  assert.deepEqual(await readSearchResult(session, "main", ref, BACKGROUND_CONTEXT), { kind: "bangumi", anime_id: "123", rows: [], partial: false });
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("native search checks current authorization before the catalog effect", async () => {
  let calls = 0;
  const { repo, session, toolContext } = await fixture(() => { calls += 1; return Promise.resolve(Response.json({})); });
  toolContext.assertAuthorized = () => Promise.reject(new Error("authorization revoked"));
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "123" }), { stopReason: "toolUse" }), fauxAssistantMessage("Access denied.")], [searchBangumi]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Search", undefined, BACKGROUND_CONTEXT);
  assert.equal(calls, 0);
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  assert.ok(entries.some((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.isError));
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
