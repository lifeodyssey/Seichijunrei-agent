import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { webSearch } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

for (const markup of ["", '<div class="result"><a>No link</a></div>', '<div class="result"><a class="result__a" href="javascript:alert(1)">Bad link</a></div>', '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=javascript:alert(1)">Bad redirect</a></div>']) {
  void test(`web search rejects missing or non-http source markup: ${markup.slice(0, 65)}`, async () => {
    const { repo, toolContext } = await fixture(() => { throw new Error("No catalog call"); });
    toolContext.webFetch = () => Promise.resolve(new Response(markup));
    const { message } = await executeTool(toolContext, "web_search", { query: "Title" }, [webSearch]);
    assert.deepEqual(message.details, { results: [] });
    assert.deepEqual(message.content, [{ type: "text", text: "No results found for: Title" }]);
    await repo.close(BACKGROUND_CONTEXT);
  });
}

void test("web search preserves direct external origins and bounds ranked result text", async () => {
  const { repo, toolContext } = await fixture(() => { throw new Error("No catalog call"); });
  toolContext.webFetch = () => Promise.resolve(new Response(Array.from({ length: 7 }, (_, index) => `<div class="result"><a class="result__a" href="https://evil.test/l/?uddg=https://wikipedia.org">${String(index)}${"A".repeat(500)}</a></div>`).join("")));
  const { message } = await executeTool(toolContext, "web_search", { query: "Title" }, [webSearch]);
  assert.equal(JSON.stringify(message.details).match(/source_tier/g)?.length, 5);
  assert.equal(JSON.stringify(message.details).match(/unverified/g)?.length, 5);
  assert.doesNotMatch(JSON.stringify(message.details), /A{201}/);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a web search backend refusal becomes a native execution error", async () => {
  const { repo, toolContext } = await fixture(() => { throw new Error("No catalog call"); });
  toolContext.webFetch = () => Promise.resolve(new Response("Anti-bot", { status: 202 }));
  const { message } = await executeTool(toolContext, "web_search", { query: "Title" }, [webSearch]);
  assert.equal(message.isError, true);
  assert.match(JSON.stringify(message.content), /temporarily unavailable/);
  await repo.close(BACKGROUND_CONTEXT);
});
