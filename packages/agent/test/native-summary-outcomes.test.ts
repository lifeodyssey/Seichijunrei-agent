import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

const title = "The complete catalog title ".repeat(15);
const cases = [
  { name: "resolve_anime", args: { title: "Requested title" }, result: { outcome: "resolved", match: { bangumi_id: "1", title } }, summary: `[resolve_anime: resolved to ${title} (id=1)]` },
  { name: "respond", args: { kind: "qa", message: "The complete user-facing answer. ".repeat(20) }, result: {}, summary: "[respond: completed]" },
];

for (const item of cases) {
  void test(`native ${item.name} stores a complete outcome with its one-time summary annotation`, async () => {
    const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json(item.result)));
    const provider = fauxProvider();
    provider.setResponses([fauxAssistantMessage(fauxToolCall(item.name, item.args), { stopReason: "toolUse" }), fauxAssistantMessage("Done.")]);
    const models = createModels();
    models.setProvider(provider.provider);
    const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, context);
    try {
      getOrThrow(await (await harness.lane("main", context)).prompt("Request", undefined, context));
      const entry = (await session.findEntries({ type: "message" }, context)).find((entry) => entry.type === "message" && entry.message.role === "toolResult");
      assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
      const details: unknown = entry.message.details;
      assert.ok(details && typeof details === "object");
      assert.equal(Reflect.get(details, "frozenSummary"), item.summary);
      assert.ok(JSON.stringify(entry.message.content).length > 200);
      assert.equal(entry.message.isError, false);
    } finally { await harness.close(context); await repo.close(context); }
  });
}

void test("a failed native tool retains its complete error and cannot add executed facts", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.reject(new Error("Catalog failure ".repeat(30))));
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Unexecuted entity" }), { stopReason: "toolUse" }), fauxAssistantMessage("Unavailable.")]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, context);
  try {
    getOrThrow(await (await harness.lane("main", context)).prompt("Request", undefined, context));
    const entry = (await session.findEntries({ type: "message" }, context)).find((entry) => entry.type === "message" && entry.message.role === "toolResult");
    assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
    assert.equal(entry.message.isError, true);
    assert.ok(entry.message.details && typeof entry.message.details === "object");
    assert.equal(Reflect.get(entry.message.details, "executedFacts"), undefined);
    assert.equal(Reflect.get(entry.message.details, "frozenSummary"), undefined);
    assert.ok(Reflect.get(entry.message.details, "execution"));
    assert.match(JSON.stringify(entry.message.content), /Catalog failure/);
  } finally { await harness.close(context); await repo.close(context); }
});
