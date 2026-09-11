import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

void test("production composition runs native tools and public hooks on a MemorySessionRepo", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.reject(new Error("No catalog request expected")));
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage(fauxToolCall("respond", { kind: "greeting", message: "Hello!" }), { stopReason: "toolUse" })]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, models, model: provider.getModel(), toolContext }, BACKGROUND_CONTEXT);
  const lane = await harness.lane("main", BACKGROUND_CONTEXT);
  const hooks: string[] = [];
  harness.hooks.on("before_drive", ({ lane }) => { hooks.push(lane); });
  const admission = await lane.accept({ kind: "prompt", operationId: "greeting", prompt: "Hello" }, BACKGROUND_CONTEXT);
  assert.equal(admission.ok, true);
  const result = await lane.drive({ operationId: "greeting", waitForRetry: false }, BACKGROUND_CONTEXT);
  assert.ok(result.ok && result.value.kind === "settled");
  assert.equal(result.value.outcome.status, "completed");
  assert.deepEqual(hooks, ["main"]);
  assert.equal((await harness.getTools(BACKGROUND_CONTEXT)).length, 7);
  const entries = await lane.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  assert.ok(entries.some((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "respond"));
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
