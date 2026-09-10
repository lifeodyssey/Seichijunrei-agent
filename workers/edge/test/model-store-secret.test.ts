import test from "node:test";
import assert from "node:assert/strict";
import { REDACTED } from "../src/agent/egress/secret-scrub.ts";
import { nativeHostModels, nativeByokModels } from "../src/agent/host/native-models.ts";

const prompt = { messages: [{ role: "user" as const, content: "Hello", timestamp: 0 }] };
function completion() {
  const chunk = { id: "test", object: "chat.completion.chunk", created: 0, model: "mimo-v2.5", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}

function recordingFetch(requests: Request[]) {
  return (input: Parameters<typeof fetch>[0]) => {
    requests.push(new Request(input));
    return Promise.resolve(completion());
  };
}

void test("a native server turn resolves its MiMo Secrets Store binding value", async () => {
  const requests: Request[] = [];
  const native = await nativeHostModels("store-mimo", recordingFetch(requests));
  assert.equal(native.available, true);
  await native.models.completeSimple(native.model, prompt);
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer store-mimo");
});

void test("the store-bound server key is scrubbed from native diagnostics", async () => {
  const native = await nativeHostModels("store-mimo");
  assert.equal(native.scrub.text("egress reported: store-mimo"), `egress reported: ${REDACTED}`);
});

void test("the next native incarnation uses a rotated store value without retaining the previous key", async () => {
  const requests: Request[] = [];
  const fetch = recordingFetch(requests);
  const first = await nativeHostModels("initial-mimo", fetch);
  await first.models.completeSimple(first.model, prompt);
  const second = await nativeHostModels("rotated-mimo", fetch);
  await second.models.completeSimple(second.model, prompt);
  assert.deepEqual(requests.map((request) => request.headers.get("authorization")),
    ["Bearer initial-mimo", "Bearer rotated-mimo"]);
  assert.equal(second.scrub.text("initial-mimo"), "initial-mimo");
  assert.equal(second.scrub.text("rotated-mimo"), REDACTED);
});

void test("a BYOK native turn runs on the caller key alone, never the server binding", async () => {
  const requests: Request[] = [];
  const byok = await nativeByokModels({
    family: "openai-compatible", provider: "openai",
    baseUrl: "https://api.openai.com/v1", modelId: "gpt-4.1", secret: "caller-key",
  }, recordingFetch(requests));
  await byok.models.completeSimple(byok.model, prompt);
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer caller-key");
});

void test("an absent or blank store value keeps the keyless controlled-cancellation model", async () => {
  assert.equal((await nativeHostModels(undefined)).available, false);
  assert.equal((await nativeHostModels("   ")).available, false);
});
