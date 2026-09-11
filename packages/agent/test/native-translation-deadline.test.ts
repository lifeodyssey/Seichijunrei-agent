import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT, withCancel } from "@earendil-works/pi-agent-core/harness/context";
import type { Model } from "@earendil-works/pi-ai";
import { translateAnimeTitle } from "@animichi/agent/tools";
import { createOperationModels } from "@animichi/agent/models";
import { executeTool, fixture } from "./native-tool-fixture.ts";

const model: Model<"openai-completions"> = {
  id: "translate", name: "Translate", api: "openai-completions", provider: "openai", baseUrl: "https://api.openai.com/v1",
  reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function pendingTransport() {
  const received = deferred<Request>();
  const response = deferred<Response>();
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    request.signal.addEventListener("abort", () => { response.reject(request.signal.reason); }, { once: true });
    received.resolve(request);
    return response.promise;
  };
  return { fetch, received: received.promise, response };
}

void test("translation cancels the native provider at 85 seconds and commits a tool error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { repo, toolContext } = await fixture(() => { throw new Error("No catalog request"); });
  const transport = pendingTransport();
  const models = await createOperationModels(model, "translation-key", transport.fetch);
  toolContext.translation = { models, model, payer: "platform" };
  const executed = executeTool(toolContext, "translate_anime_title", { title: "君の名は。", target_language: "en" }, [translateAnimeTitle]);
  t.after(async () => { transport.response.reject(new Error("Test cleanup")); await executed; await repo.close(BACKGROUND_CONTEXT); });
  const request = await transport.received;
  t.mock.timers.tick(84_999);
  assert.equal(request.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(request.signal.aborted, true);
  const { message } = await executed;
  assert.equal(message.isError, true);
  assert.match(JSON.stringify(message.content), /translation.*85/i);
});

void test("catalog time counts against the same 85-second supplemental model budget", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const catalog = pendingTransport();
  const { repo, toolContext } = await fixture(catalog.fetch);
  const transport = pendingTransport();
  const models = await createOperationModels(model, "translation-key", transport.fetch);
  toolContext.translation = { models, model, payer: "byok" };
  const executed = executeTool(toolContext, "translate_anime_title", { title: "君の名は。", target_language: "zh" }, [translateAnimeTitle]);
  t.after(async () => { transport.response.reject(new Error("Test cleanup")); await executed; await repo.close(BACKGROUND_CONTEXT); });
  const catalogRequest = await catalog.received;
  t.mock.timers.tick(20_000);
  catalog.response.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" }));
  const modelRequest = await transport.received;
  t.mock.timers.tick(64_999);
  assert.equal(modelRequest.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(modelRequest.signal.aborted, true);
  assert.equal(catalogRequest.signal.aborted, true);
  assert.equal((await executed).message.isError, true);
});

void test("caller cancellation reaches an active supplemental provider before the deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { repo, toolContext } = await fixture(() => { throw new Error("No catalog request"); });
  const transport = pendingTransport();
  const models = await createOperationModels(model, "translation-key", transport.fetch);
  toolContext.translation = { models, model, payer: "platform" };
  const caller = withCancel(BACKGROUND_CONTEXT);
  const invocation = { invocationId: "translation", operationId: "operation", turnId: "turn", getMemo: () => Promise.resolve(undefined), setMemo: () => Promise.resolve() };
  const executed = translateAnimeTitle.execute("call", { title: "Title", target_language: "ja" }, () => undefined, toolContext, invocation, caller.context);
  t.after(async () => { transport.response.reject(new Error("Test cleanup")); await executed.catch(() => undefined); await repo.close(BACKGROUND_CONTEXT); });
  const request = await transport.received;
  t.mock.timers.tick(1_000);
  caller.cancel(new DOMException("Caller cancelled translation", "AbortError"));
  assert.equal(request.signal.aborted, true);
  await assert.rejects(executed, { name: "AbortError", message: "Caller cancelled translation" });
});

void test("completed translation retains native usage and releases its deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { repo, toolContext } = await fixture(() => { throw new Error("No catalog request"); });
  const transport = pendingTransport();
  const models = await createOperationModels(model, "translation-key", transport.fetch);
  toolContext.translation = { models, model, payer: "byok" };
  const executed = executeTool(toolContext, "translate_anime_title", { title: "君の名は。", target_language: "en" }, [translateAnimeTitle]);
  t.after(async () => { transport.response.reject(new Error("Test cleanup")); await executed; await repo.close(BACKGROUND_CONTEXT); });
  const request = await transport.received;
  t.mock.timers.tick(30_000);
  const chunk = { id: "translation", object: "chat.completion.chunk", created: 0, model: "translate", choices: [{ index: 0, delta: { content: "Your Name" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
  transport.response.resolve(new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
  const { message } = await executed;
  assert.equal(message.isError, false);
  assert.deepEqual(message.usage, { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  t.mock.timers.tick(55_000);
  assert.equal(request.signal.aborted, false);
});
