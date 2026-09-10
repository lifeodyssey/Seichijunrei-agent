import test from "node:test";
import assert from "node:assert/strict";
import { nativeHostModels, nativeByokModels } from "../src/agent/host/native-models.ts";

const prompt = { messages: [{ role: "user" as const, content: "Hello", timestamp: 0 }] };
function completion() {
  const chunk = { id: "test", object: "chat.completion.chunk", created: 0, model: "mimo-v2.5", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

void test("default bootstrap uses the official Xiaomi model, price and isolated server credential", async () => {
  const requests: Request[] = [];
  const native = await nativeHostModels("server-key", (input) => { requests.push(new Request(input)); return Promise.resolve(completion()); });
  assert.equal(native.model.provider, "xiaomi");
  assert.equal(native.model.cost.input, 0.14);
  const result = await native.models.completeSimple(native.model, prompt);
  assert.equal(result.stopReason, "stop");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer server-key");
  assert.equal(new URL(requests[0].url).hostname, "api.xiaomimimo.com");
});

void test("BYOK native Models use only the ephemeral request key and logout cannot fall back", async () => {
  const requests: Request[] = [];
  const native = await nativeByokModels({ family: "openai-compatible", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1", secret: "caller-key" },
    (input) => { requests.push(new Request(input)); return Promise.resolve(completion()); });
  assert.equal((await native.models.completeSimple(native.model, prompt)).stopReason, "stop");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer caller-key");
  await native.models.logout("openai");
  assert.equal((await native.models.completeSimple(native.model, prompt)).stopReason, "error");
  assert.equal(requests.length, 1);
});

void test("missing server credentials preserve a keyless model for controlled cancellation only", async () => {
  const native = await nativeHostModels(undefined);
  assert.equal(native.available, false);
  assert.equal((await native.models.completeSimple(native.model, prompt)).stopReason, "error");
});

void test("a cold native harness cancels the original BYOK operation without reusing a server model", async () => {
  const { MemorySessionRepo } = await import("@earendil-works/pi-agent-core/harness/session");
  const { BACKGROUND_CONTEXT: context } = await import("@earendil-works/pi-agent-core/harness/context");
  const { AgentHarness } = await import("@earendil-works/pi-agent-core");
  const repo = new MemorySessionRepo();
  let session = await repo.create({}, context);
  const caller = await nativeByokModels({ family: "openai-compatible", provider: "openai", baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1", secret: "lost-key" });
  let { harness } = await AgentHarness.create({ session, ...caller }, context);
  let lane = await harness.lane("main", context);
  const accepted = await lane.accept({ kind: "prompt", operationId: "cold-byok", prompt: "Never call a model" }, context);
  assert.equal(accepted.ok, true);
  await harness.close(context);
  session = await repo.open(session.metadata, context);
  const server = await nativeHostModels(undefined);
  ({ harness } = await AgentHarness.create({ session, models: server.models, model: server.model }, context));
  lane = await harness.lane("main", context);
  assert.equal((await lane.requestAbort("cold-byok", context)).ok, true);
  const result = await lane.drive({ operationId: "cold-byok", waitForRetry: false }, context);
  assert.equal(result.ok, true);
  assert.equal((await lane.getResult("cold-byok", context))?.status, "aborted");
  await harness.close(context);
  await repo.close(context);
});
