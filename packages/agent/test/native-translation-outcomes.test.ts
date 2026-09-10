import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { translateAnimeTitle } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

for (const scenario of [
  { name: "missing Chinese title", response: { outcome: "resolved", match: { bangumi_id: "1", title: "Your Name Season 2", title_cn: "" } } },
  { name: "ambiguous title", response: { outcome: "not_found", reason: "anime_not_found" } },
  { name: "wrong sequel", response: { outcome: "resolved", match: { bangumi_id: "1", title: "Your Name", title_cn: "别的作品" } } },
]) {
  void test(`translation preserves the original for ${scenario.name} without a model`, async () => {
    const { repo, toolContext } = await fixture(() => Promise.resolve(Response.json(scenario.response)));
    const { message } = await executeTool(toolContext, "translate_anime_title", { title: "Your Name Season 2", target_language: "zh" }, [translateAnimeTitle]);
    assert.deepEqual(message.details, { original: "Your Name Season 2", translated: "Your Name Season 2", source: "untranslated", confidence: 0 });
    await repo.close(BACKGROUND_CONTEXT);
  });
}

for (const answer of [fauxAssistantMessage(""), fauxAssistantMessage("Failure", { stopReason: "error" }), fauxAssistantMessage("Cancelled", { stopReason: "aborted" })]) {
  void test(`translation cannot call a ${answer.stopReason} or empty model response a successful translation`, async () => {
    const { repo, toolContext } = await fixture(() => { throw new Error("No catalog call"); });
    const provider = fauxProvider();
    const models = createModels();
    models.setProvider(provider.provider);
    provider.setResponses([answer]);
    toolContext.translation = { models, model: provider.getModel(), payer: "byok" };
    const { message } = await executeTool(toolContext, "translate_anime_title", { title: "Title", target_language: "ja" }, [translateAnimeTitle]);
    assert.deepEqual(message.details, { original: "Title", translated: "Title", source: "untranslated", confidence: 0, payer: "byok" });
    assert.ok(message.usage);
    await repo.close(BACKGROUND_CONTEXT);
  });
}
