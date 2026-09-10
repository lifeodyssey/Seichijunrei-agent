import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { webSearch } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

function refusalResponse(status: number) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("Upstream refusal")); },
    cancel() { cancelled = true; },
  });
  return { response: new Response(body, { status }), cancelled: () => cancelled };
}

async function rejectedSearch(context: TestContext, status: number) {
  const { repo, toolContext } = await fixture(() => Promise.reject(new Error("Catalog must not run")));
  context.after(() => repo.close(BACKGROUND_CONTEXT));
  const refusal = refusalResponse(status);
  context.after(() => refusal.response.body?.cancel());
  toolContext.webFetch = () => Promise.resolve(refusal.response);
  const { message } = await executeTool(toolContext, "web_search", { query: "anime title" }, [webSearch]);
  assert.equal(message.isError, true);
  assert.equal(refusal.cancelled(), true, "An upstream refusal must release its original response body before returning");
}

void test("web search releases an anti-bot response before returning its native tool error", async (context) => {
  await rejectedSearch(context, 202);
});

void test("web search releases a redirect response before returning its native tool error", async (context) => {
  await rejectedSearch(context, 302);
});

void test("web search releases an unavailable upstream response before returning its native tool error", async (context) => {
  await rejectedSearch(context, 503);
});
