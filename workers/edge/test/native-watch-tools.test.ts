import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "../../../packages/agent/test/native-tool-fixture.ts";
import { nativeWatchResponse } from "../src/agent/views/watch-response.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";

void test("reconnection restores settled native tools with effective arguments and resumes the remaining tool", async () => {
  const resources = await fixture(() => Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" })));
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage([
    fauxToolCall("resolve_anime", { title: "First" }, { id: "first-tool" }),
    fauxToolCall("resolve_anime", { title: "Second" }, { id: "second-tool" }),
  ], { stopReason: "toolUse" }), fauxAssistantMessage("Finished")]);
  const models = createModels(); models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session: resources.session, toolContext: resources.toolContext, models, model: provider.getModel() }, context);
  const release = Promise.withResolvers<boolean>();
  const settled = Promise.withResolvers<boolean>();
  harness.hooks.on("before_tool", async (event) => {
    if (event.toolCallId === "second-tool") await release.promise;
    return { args: { title: `Effective ${event.toolCallId}` } };
  });
  harness.events.on("tool_end", (event) => { if (event.toolCallId === "first-tool") settled.resolve(true); });
  const lane = await harness.lane("main", context);
  await lane.accept({ kind: "prompt", prompt: "Both", operationId: "tools" }, context);
  const drive = lane.drive({ operationId: "tools" }, context);
  await settled.promise;
  const watch = await lane.watch(context);
  assert.equal(watch.snapshot.operation?.runningTools.find((tool) => tool.toolCallId === "first-tool")?.status, "settled");
  const body = nativeWatchResponse(watch, "tools-session", "tools", new SecretScrub()).text();
  release.resolve(true); await drive;
  const wire = await body;
  assert.doesNotMatch(wire, /"execution"|"frozenSummary"|"executedFacts"/);
  assert.match(wire, /"toolCallId":"first-tool","output":/);
  assert.match(wire, /Effective first-tool/);
  assert.match(wire, /"toolCallId":"second-tool","output":/);
  const replay = await nativeWatchResponse(await lane.watch(context), "tools-session", "tools", new SecretScrub()).text();
  assert.match(replay, /"toolCallId":"first-tool","output":/);
  assert.match(replay, /Effective first-tool/);
  assert.equal(replay.match(/"toolCallId":"first-tool","output":/g)?.length, 1);
  await harness.close(context);
});
