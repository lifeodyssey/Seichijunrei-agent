import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { readSearchResult, planRoute } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

const point = { id: "1", name: "Station", bangumi_id: "1", screenshot_url: "", latitude: 35, longitude: 139 };

for (const scenario of [
  { name: "malformed details", toolName: "search_bangumi", isError: false, details: { rows: [] } },
  { name: "failed result", toolName: "search_bangumi", isError: true, details: { kind: "bangumi", anime_id: "1", rows: [point], partial: false } },
  { name: "unrelated tool", toolName: "web_search", isError: false, details: { kind: "bangumi", anime_id: "1", rows: [point], partial: false } },
]) {
  void test(`route refs reject ${scenario.name}`, async () => {
    const { repo, session } = await fixture(() => { throw new Error("No catalog"); });
    const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
    const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "call", toolName: scenario.toolName, timestamp: 0, isError: scenario.isError, details: scenario.details, content: [] }, BACKGROUND_CONTEXT);
    assert.equal(await readSearchResult(session, "main", ref, BACKGROUND_CONTEXT), undefined);
    await repo.close(BACKGROUND_CONTEXT);
  });
}

void test("native fork ancestry resolves the original ref after reopening without catalog work", async () => {
  const { repo, session } = await fixture(() => { throw new Error("No catalog"); });
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const details = { kind: "bangumi", anime_id: "1", rows: [point], partial: false };
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "search_bangumi", timestamp: 0, isError: false, details, content: [] }, BACKGROUND_CONTEXT);
  await session.createBranch("fork", ref, BACKGROUND_CONTEXT);
  await session.close(BACKGROUND_CONTEXT);
  const reopened = await repo.open(session.metadata, BACKGROUND_CONTEXT);
  assert.deepEqual(await readSearchResult(reopened, "fork", ref, BACKGROUND_CONTEXT), details);
  assert.equal(await readSearchResult(reopened, "missing-branch", ref, BACKGROUND_CONTEXT), undefined);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a custom entry cannot be used as a search result", async () => {
  const { repo, session } = await fixture(() => { throw new Error("No catalog"); });
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendCustomEntry("note", {}, BACKGROUND_CONTEXT);
  assert.equal(await readSearchResult(session, "main", ref, BACKGROUND_CONTEXT), undefined);
  await repo.close(BACKGROUND_CONTEXT);
});

for (const scenario of [{ partial: false, status: "empty" }, { partial: true, status: "pending_sync" }]) {
  void test(`route returns ${scenario.status} before making any route call`, async () => {
    const { repo, session, toolContext } = await fixture(() => { throw new Error("No catalog"); });
    const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
    const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "search_bangumi", timestamp: 0, isError: false, details: { kind: "bangumi", anime_id: "1", rows: [], partial: scenario.partial }, content: [] }, BACKGROUND_CONTEXT);
    const { message } = await executeTool(toolContext, "plan_route", { search_result_ref: ref }, [planRoute]);
    assert.deepEqual(message.details, { status: scenario.status });
    await repo.close(BACKGROUND_CONTEXT);
  });
}

void test("routing an unknown ref returns an explicit stale result", async () => {
  const { repo, toolContext } = await fixture(() => { throw new Error("No catalog"); });
  const { message } = await executeTool(toolContext, "plan_route", { search_result_ref: "unknown" }, [planRoute]);
  assert.deepEqual(message.details, { status: "stale_ref" });
  await repo.close(BACKGROUND_CONTEXT);
});
