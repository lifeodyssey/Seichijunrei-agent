import { ChatResponseDataPart } from "@animichi/contract";
import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { respond } from "@animichi/agent/tools";
import { fixture, harnessFor } from "../../../packages/agent/test/native-tool-fixture.ts";
import { nativeWatchResponse } from "../src/agent/views/watch-response.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";

async function prepared() {
  const native = await fixture(() => Promise.reject(new Error("No catalog traffic expected")));
  const { harness } = await harnessFor(native.toolContext, [fauxAssistantMessage(fauxToolCall("respond", { kind: "greeting", message: "Hello sk-private123456" }), { stopReason: "toolUse" })], [respond]);
  const lane = await harness.lane("main", BACKGROUND_CONTEXT);
  const accepted = await lane.accept({ kind: "prompt", prompt: "Hello", operationId: "op-watch" }, BACKGROUND_CONTEXT);
  assert.equal(accepted.ok, true);
  return { ...native, harness, lane };
}

void test("native snapshot/live pairing emits the actual respond answer using AI SDK framing", async () => {
  const { harness, lane } = await prepared();
  const watch = await lane.watch(BACKGROUND_CONTEXT);
  const response = nativeWatchResponse(watch, "session-watch", "op-watch", new SecretScrub());
  const body = response.text();
  await lane.drive({ operationId: "op-watch" }, BACKGROUND_CONTEXT);
  const wire = await body;
  assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
  assert.match(wire, /"type":"data-response"/);
  assert.match(wire, /"intent":"greet_user"/);
  assert.match(wire, /"session_id":"session-watch"/);
  assert.doesNotMatch(wire, /sk-private123456|tool-input.*respond/);
  assert.equal(wire.match(/\[DONE\]/g)?.length, 1);
  const payloads = wire.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as { type: string; data?: unknown });
  const answer = payloads.filter((chunk) => chunk.type === "data-response").at(-1);
  assert.equal(ChatResponseDataPart.safeParse(answer?.data).success, true);
  await harness.close(BACKGROUND_CONTEXT);
});

void test("disconnect only releases the native watch; a new watch restores the committed result", async () => {
  const { harness, lane } = await prepared();
  const first = nativeWatchResponse(await lane.watch(BACKGROUND_CONTEXT), "session-watch", "op-watch", new SecretScrub());
  await first.body?.cancel();
  await lane.drive({ operationId: "op-watch" }, BACKGROUND_CONTEXT);
  assert.equal((await lane.getResult("op-watch", BACKGROUND_CONTEXT))?.status, "completed");
  const reconnected = nativeWatchResponse(await lane.watch(BACKGROUND_CONTEXT), "session-watch", "op-watch", new SecretScrub());
  assert.match(await reconnected.text(), /"intent":"greet_user"/);
  await harness.close(BACKGROUND_CONTEXT);
});

void test("replaying an old result never projects the newer native operation's streaming message", async () => {
  const { createPilgrimageHarness } = await import("@animichi/agent/harness");
  const { nativeByokModels } = await import("../src/agent/host/native-models.ts");
  const second = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  const observed = Promise.withResolvers<boolean>();
  let calls = 0;
  const encode = (content: string, finish: string | null) => new TextEncoder().encode(`data: ${JSON.stringify({ id: "wire", object: "chat.completion.chunk", created: 0, model: "gpt-4.1", choices: [{ index: 0, delta: { content }, finish_reason: finish }] })}\n\n`);
  const native = await nativeByokModels({ family: "openai-compatible", provider: "openai", modelId: "gpt-4.1", baseUrl: "https://api.openai.com/v1", secret: "test-key" }, () => {
    calls += 1;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      if (calls === 1) { controller.enqueue(encode("First answer", "stop")); controller.close(); return; }
      controller.enqueue(encode("New operation confidential draft".repeat(20), null)); second.resolve(controller);
    } });
    return Promise.resolve(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  });
  const resources = await fixture(() => Promise.reject(new Error("No catalog traffic")));
  const { harness } = await createPilgrimageHarness({ session: resources.session, toolContext: resources.toolContext, models: native.models, model: native.model }, BACKGROUND_CONTEXT);
  const lane = await harness.lane("main", BACKGROUND_CONTEXT);
  await lane.accept({ kind: "prompt", prompt: "First", operationId: "first" }, BACKGROUND_CONTEXT);
  await lane.drive({ operationId: "first" }, BACKGROUND_CONTEXT);
  const first = await lane.getResult("first", BACKGROUND_CONTEXT); assert.ok(first);
  harness.events.on("message_update", (event) => { if (event.runId === "second") observed.resolve(true); });
  await lane.accept({ kind: "prompt", prompt: "Second", operationId: "second" }, BACKGROUND_CONTEXT);
  const drive = lane.drive({ operationId: "second" }, BACKGROUND_CONTEXT);
  await observed.promise;
  const watch = await lane.watch(BACKGROUND_CONTEXT);
  assert.equal(watch.snapshot.operation?.id, "second");
  assert.match(JSON.stringify(watch.snapshot.operation.streamingMessage), /New operation confidential draft/);
  watch.snapshot = { ...watch.snapshot, lastResult: first };
  const wire = await nativeWatchResponse(watch, "session-watch", "first", new SecretScrub()).text();
  assert.match(wire, /First answer/);
  assert.doesNotMatch(wire, /New operation confidential draft/);
  const controller = await second.promise; controller.enqueue(encode("", "stop")); controller.close();
  await drive; await harness.close(BACKGROUND_CONTEXT);
});

void test("a silent native watch emits the bounded heartbeat and cancellation leaves its operation admitted", async (context) => {
  const { harness, lane } = await prepared();
  context.mock.timers.enable({ apis: ["setInterval"] });
  const response = nativeWatchResponse(await lane.watch(BACKGROUND_CONTEXT), "session-watch", "op-watch", new SecretScrub());
  assert.ok(response.body);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"start"/);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"start-step"/);
  const heartbeat = reader.read();
  context.mock.timers.tick(15_000);
  await reader.cancel();
  assert.equal(new TextDecoder().decode((await heartbeat).value), ": heartbeat\n\n");
  assert.equal((await lane.inspectExecution(BACKGROUND_CONTEXT)).current?.id, "op-watch");
  await lane.drive({ operationId: "op-watch" }, BACKGROUND_CONTEXT);
  assert.equal((await lane.getResult("op-watch", BACKGROUND_CONTEXT))?.status, "completed");
  await harness.close(BACKGROUND_CONTEXT);
});
