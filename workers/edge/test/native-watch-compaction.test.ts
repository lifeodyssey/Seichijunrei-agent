import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "../../../packages/agent/test/native-tool-fixture.ts";
import { nativeWatchResponse, watchNativeOperation } from "../src/agent/views/watch-response.ts";
import { readHistoryStorage } from "../src/agent/views/history.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";

void test("an actual native compaction preserves reconnectable earlier answers", async (t) => {
  const resources = await fixture(() => Promise.reject(new Error("No catalog requests")));
  const provider = fauxProvider(); const models = createModels(); models.setProvider(provider.provider);
  provider.setResponses([fauxAssistantMessage("Original durable answer"), fauxAssistantMessage("Second durable answer"),
    fauxAssistantMessage("A compact summary."), fauxAssistantMessage("The current turn summary.")]);
  const { harness } = await createPilgrimageHarness({ session: resources.session, models, model: provider.getModel(),
    compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 1 }, toolContext: resources.toolContext }, context);
  t.after(() => harness.close(context));
  const lane = await harness.lane("main", context);
  getOrThrow(await lane.accept({ kind: "prompt", prompt: "First question", operationId: "old-operation" }, context));
  getOrThrow(await lane.drive({ operationId: "old-operation" }, context));
  getOrThrow(await lane.prompt("Second question", undefined, context));
  assert.equal(getOrThrow(await lane.compact({}, context)).compaction.status, "completed");
  const history = await readHistoryStorage(resources.session, { offset: 0, limit: 100 }, context);
  assert.ok(history.messages.some((message) => message.content === "Original durable answer"));
  const watch = await watchNativeOperation(lane, "old-operation", context); assert.ok(watch);
  const wire = await nativeWatchResponse(watch, resources.session.metadata.id, "old-operation", new SecretScrub()).text();
  assert.match(wire, /Original durable answer/);
  assert.doesNotMatch(wire, /Second durable answer|A compact summary/);
});
