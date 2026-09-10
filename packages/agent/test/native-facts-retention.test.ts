import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

const ambiguous = { outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates: [
  { bangumi_id: "1", title: "First option ".repeat(20) }, { bangumi_id: "2", title: "Second option" },
] };

void test("actual tool arguments retain eight bounded entities and move a repeat to the tail without evicting older facts", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json(ambiguous)));
  const names = ["京都".repeat(40), "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Unretained ninth", "Two"];
  const observed: string[] = [];
  const provider = fauxProvider();
  provider.setResponses([...names.map((title) => fauxAssistantMessage(fauxToolCall("resolve_anime", { title }), { stopReason: "toolUse" })),
    (request) => { observed.push(JSON.stringify(request.messages)); return fauxAssistantMessage("Which title?"); }]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, context);
  try {
    getOrThrow(await (await harness.lane("main", context)).prompt("Find these works", undefined, context));
    const text = observed.join("\n");
    assert.equal(text.match(/Verbatim entity retained/gu)?.length, 8);
    assert.doesNotMatch(text, /earlier resolve_anime call: 「Unretained ninth」/);
    assert.ok(text.indexOf("call: 「Eight」") < text.indexOf("call: 「Two」"));
    const first = (await session.findEntries({ type: "message" }, context)).sort((left, right) => left.seq - right.seq)
      .find((entry) => entry.type === "message" && entry.message.role === "toolResult");
    assert.ok(first?.type === "message" && first.message.role === "toolResult");
    const details: unknown = first.message.details;
    assert.ok(details && typeof details === "object");
    assert.deepEqual(Reflect.get(details, "executedFacts"), { retainedEntity: `${"京都".repeat(15)}京…` });
  } finally { await harness.close(context); await repo.close(context); }
});

void test("native context preserves image content beside a stored text summary", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.reject(new Error("No catalog work expected")));
  const branch = await session.createBranch("main", null, context);
  const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" };
  const entryId = await branch.appendMessage({ role: "toolResult", toolCallId: "image", toolName: "web_search", timestamp: 0,
    content: [{ type: "text", text: "Stored raw text" }, image], isError: false, details: { frozenSummary: "Frozen text" } }, context);
  const provider = fauxProvider();
  const seen: unknown[] = [];
  provider.setResponses([(request) => { seen.push(request.messages.find((message) => message.role === "toolResult")?.content); return fauxAssistantMessage("Seen."); }]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, context);
  try {
    getOrThrow(await (await harness.lane("main", context)).prompt("Continue", undefined, context));
    assert.deepEqual(seen, [[{ type: "text", text: "Frozen text" }, image]]);
    const original = await session.getEntry(entryId, context);
    assert.ok(original?.type === "message" && original.message.role === "toolResult");
    assert.deepEqual(original.message.content, [{ type: "text", text: "Stored raw text" }, image]);
  } finally { await harness.close(context); await repo.close(context); }
});
