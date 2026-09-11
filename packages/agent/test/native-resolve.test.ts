import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { resolveAnime, projectPilgrimage } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

void test("clarification is derived from committed native results with the original offered candidates", async () => {
  const candidates = [{ bangumi_id: "1", title: "First", points_count: 3 }, { bangumi_id: "2", title: "Second", points_count: 4 }];
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates })));
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Title" }), { stopReason: "toolUse" }), fauxAssistantMessage("Which one?")], [resolveAnime]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Find", undefined, BACKGROUND_CONTEXT);
  const state = projectPilgrimage(await session.findEntries(undefined, BACKGROUND_CONTEXT));
  assert.equal(state.clarification?.reason, "anime_ambiguity");
  assert.deepEqual(state.clarification.candidates, [{ id: "1", title: "First", points_count: 3 }, { id: "2", title: "Second", points_count: 4 }]);
  assert.equal(state.currentAnime, undefined);
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
