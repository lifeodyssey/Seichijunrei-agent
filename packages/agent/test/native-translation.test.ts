import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { translateAnimeTitle } from "@animichi/agent/tools";
import { createOperationModels } from "@animichi/agent/models";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

void test("translation prefers the curated title and commits its provenance as native details", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ outcome: "resolved", match: { bangumi_id: "1", title: "君の名は。", title_cn: "你的名字。" } })));
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("translate_anime_title", { title: "君の名は。", target_language: "zh" }), { stopReason: "toolUse" }), fauxAssistantMessage("你的名字。")], [translateAnimeTitle]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Translate", undefined, BACKGROUND_CONTEXT);
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  const result = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
  assert.ok(result?.type === "message" && result.message.role === "toolResult");
  assert.deepEqual(result.message.details, { original: "君の名は。", translated: "你的名字。", source: "catalog", confidence: 1 });
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("translation uses native model completion and attributes its exact supplemental usage", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" })));
  const model = { id: "translate", name: "Translate", api: "openai-completions" as const, provider: "openai", baseUrl: "https://api.openai.com/v1", reasoning: false, input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 };
  let calls = 0;
  const models = await createOperationModels(model, "translation-key", () => {
    calls += 1;
    const chunk = { id: "translation", object: "chat.completion.chunk", created: 0, model: "translate", choices: [{ index: 0, delta: { content: '"Your Name"' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
    return Promise.resolve(new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
  });
  toolContext.translation = { models, model, payer: "platform" };
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("translate_anime_title", { title: "君の名は。", target_language: "en" }), { stopReason: "toolUse" }), fauxAssistantMessage("Your Name")], [translateAnimeTitle]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Translate", undefined, BACKGROUND_CONTEXT);
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  const result = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
  assert.ok(result?.type === "message" && result.message.role === "toolResult");
  assert.deepEqual(result.message.usage, { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  assert.deepEqual(result.message.details, { original: "君の名は。", translated: "Your Name", source: "llm", confidence: 0.6, payer: "platform" });
  assert.equal(calls, 1);
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
