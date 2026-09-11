import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { resolveAnime, projectPilgrimage } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

for (const scenario of [
  { name: "a resolved anime", query: "Your Name", result: { outcome: "resolved", match: { bangumi_id: "1", title: "Your Name" } }, anime: { bangumiId: "1", title: "Your Name" }, reason: undefined },
  { name: "a wrong series variant", query: "Your Name Season 2", result: { outcome: "resolved", match: { bangumi_id: "1", title: "Your Name" } }, anime: undefined, reason: "anime_not_found" },
  { name: "unavailable catalog", query: "Your Name", result: { outcome: "upstream_unavailable", reason: "catalog_unavailable" }, anime: undefined, reason: undefined },
]) {
  void test(`the native projection preserves ${scenario.name}`, async () => {
    const { repo, toolContext } = await fixture(() => Promise.resolve(Response.json(scenario.result)));
    const { entries } = await executeTool(toolContext, "resolve_anime", { title: scenario.query }, [resolveAnime]);
    const state = projectPilgrimage(entries);
    assert.deepEqual(state.currentAnime, scenario.anime);
    assert.equal(state.clarification?.reason, scenario.reason);
    await repo.close(BACKGROUND_CONTEXT);
  });
}

void test("malformed or unrelated entries never overwrite an offered clarification", async () => {
  const { repo, session } = await fixture(() => { throw new Error("No catalog"); });
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  await branch.appendMessage({ role: "toolResult", toolName: "resolve_anime", toolCallId: "1", timestamp: 0, isError: false, content: [], details: { outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates: [{ bangumi_id: "1", title: "", title_cn: "标题", cover_url: "https://example.com/cover" }, { bangumi_id: "2", title: "" }] } }, BACKGROUND_CONTEXT);
  await branch.appendCustomEntry("note", {}, BACKGROUND_CONTEXT);
  await branch.appendMessage({ role: "toolResult", toolName: "resolve_anime", toolCallId: "2", timestamp: 0, isError: false, content: [], details: { outcome: "invalid" } }, BACKGROUND_CONTEXT);
  await branch.appendMessage({ role: "toolResult", toolName: "web_search", toolCallId: "3", timestamp: 0, isError: false, content: [], details: {} }, BACKGROUND_CONTEXT);
  const projected = projectPilgrimage(await session.findEntries(undefined, BACKGROUND_CONTEXT));
  assert.deepEqual(projected.clarification?.candidates, [{ id: "1", title: "标题", cover_url: "https://example.com/cover" }, { id: "2", title: "2" }]);
  await repo.close(BACKGROUND_CONTEXT);
});
