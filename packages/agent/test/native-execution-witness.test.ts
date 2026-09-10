import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { operationToolArgsPrefix } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

void test("the native result commit retains actual effective arguments after SDK temporary arguments are deleted", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" })));
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Model title" }), { stopReason: "toolUse" }), fauxAssistantMessage("Done")]);
  const models = createModels(); models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, context);
  harness.hooks.on("before_tool", () => ({ args: { title: "Effective title" } }));
  const lane = await harness.lane("main", context);
  getOrThrow(await lane.accept({ kind: "prompt", prompt: "Find it", operationId: "witness-operation" }, context));
  getOrThrow(await lane.drive({ operationId: "witness-operation" }, context));
  const entries = await lane.findEntries({ type: "message" }, context);
  const result = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
  assert.ok(result?.type === "message" && result.message.role === "toolResult" && result.message.details);
  assert.deepEqual(Reflect.get(result.message.details, "execution"), { operationId: "witness-operation", toolCallId: result.message.toolCallId, args: { title: "Effective title" } });
  assert.equal((await session.scanValues(operationToolArgsPrefix("witness-operation"), context)).length, 0);
  const modelRequest = entries.find((entry) => entry.type === "message" && entry.message.role === "assistant" && entry.message.content.some((part) => part.type === "toolCall"));
  assert.match(JSON.stringify(modelRequest), /Model title/);
  assert.doesNotMatch(JSON.stringify(modelRequest), /Effective title/);
  await harness.close(context); await repo.close(context);
});
