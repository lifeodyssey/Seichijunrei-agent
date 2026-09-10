import test from "node:test";
import assert from "node:assert/strict";
import type { Model } from "@earendil-works/pi-ai";
import { AgentHarness } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createOperationModels } from "@animichi/agent/models";

const model: Model<"openai-completions"> = {
  id: "test", name: "Test", api: "openai-completions", provider: "openai", baseUrl: "https://api.openai.com/v1",
  reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100,
};
const prompt = { messages: [{ role: "user" as const, content: "Hello", timestamp: 0 }] };

function completion() {
  const chunk = { id: "test", object: "chat.completion.chunk", created: 0, model: "test", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}

void test("native per-operation models use only the caller key and prevent per-call fetch bypass", async () => {
  const requests: Request[] = [];
  const models = await createOperationModels(model, "caller-key", (request) => { requests.push(new Request(request)); return Promise.resolve(completion()); });
  const response = await models.completeSimple(model, prompt, { fetch: () => { throw new Error("bypass"); } });
  assert.equal(response.stopReason, "stop");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer caller-key");
  assert.equal(requests[0].redirect, "manual");
  await models.logout("openai");
  assert.equal((await models.completeSimple(model, prompt)).stopReason, "error");
  assert.equal((await models.completeSimple(model, prompt, { apiKey: "ambient-key" })).stopReason, "error");
  assert.equal(requests.length, 1);
});

void test("a native harness keeps provider credentials out of committed session entries", async () => {
  const models = await createOperationModels(model, "private-operation-key", () => Promise.resolve(completion()));
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({}, BACKGROUND_CONTEXT);
  const { harness } = await AgentHarness.create({ session, models, model, tools: [] }, BACKGROUND_CONTEXT);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Hello", undefined, BACKGROUND_CONTEXT);
  const entries = await session.findEntries(undefined, BACKGROUND_CONTEXT);
  assert.ok(entries.some((entry) => entry.type === "message" && entry.message.role === "assistant"));
  assert.doesNotMatch(JSON.stringify(entries), /private-operation-key|Bearer|Authorization/);
  await models.logout("openai");
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("blank keys and non-exact provider endpoints fail before a request", async () => {
  await assert.rejects(createOperationModels(model, "  "), /credential/);
  await assert.rejects(createOperationModels({ ...model, baseUrl: "https://api.openai.com.evil.test/v1" }, "key"), /endpoint/);
  await assert.rejects(createOperationModels({ ...model, baseUrl: "http://api.openai.com/v1" }, "key"), /endpoint/);
});

void test("redirect errors never echo credentials and cannot reach the next host", async () => {
  let calls = 0;
  const models = await createOperationModels(model, "private-key", () => { calls += 1; return Promise.resolve(new Response("private-key", { status: 302, headers: { Location: "https://evil.test" } })); });
  const result = await models.completeSimple(model, prompt);
  assert.equal(result.stopReason, "error");
  assert.doesNotMatch(JSON.stringify(result), /private-key|evil\.test/);
  assert.equal(calls, 1);
});

void test("an already cancelled operation never sends provider traffic", async () => {
  let calls = 0;
  const models = await createOperationModels(model, "private-key", () => { calls += 1; return Promise.resolve(completion()); });
  const result = await models.completeSimple(model, prompt, { signal: AbortSignal.abort() });
  assert.equal(result.stopReason, "error");
  assert.equal(calls, 0);
});

void test("provider connection errors cannot expose the credential in native events", async () => {
  const models = await createOperationModels(model, "private-key", () => Promise.reject(new Error("socket failed for private-key")));
  const stream = models.streamSimple(model, prompt);
  const events = [];
  for await (const event of stream) events.push(event);
  assert.doesNotMatch(JSON.stringify(events), /private-key/);
  assert.equal((await stream.result()).stopReason, "error");
});

void test("caller options cannot override the key or forward unrelated credentials", async () => {
  const requests: Request[] = [];
  const models = await createOperationModels(model, "caller-key", (request) => { requests.push(new Request(request)); return Promise.resolve(completion()); });
  const rejected = await models.completeSimple(model, prompt, { apiKey: "ambient-key" });
  assert.equal(rejected.stopReason, "error");
  assert.equal(requests.length, 0);
  await models.completeSimple(model, prompt, { headers: { Authorization: "Bearer ambient-key", Cookie: "private-cookie", "X-Api-Key": "wrong-key" } });
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer caller-key");
  assert.equal(requests[0].headers.get("cookie"), null);
  assert.equal(requests[0].headers.get("x-api-key"), null);
});
