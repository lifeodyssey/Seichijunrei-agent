import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { fixture, harnessFor } from "../../../packages/agent/test/native-tool-fixture.ts";
import { nativeWatchResponse, watchNativeOperation } from "../src/agent/views/watch-response.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";

async function admitted() {
  const resources = await fixture(() => Promise.reject(new Error("No catalog request")));
  const { harness } = await harnessFor(resources.toolContext, [fauxAssistantMessage("Committed final answer"), fauxAssistantMessage("Newer answer")], []);
  const lane = await harness.lane("main", context);
  assert.equal((await lane.accept({ kind: "prompt", prompt: "Hello", operationId: "finishing" }, context)).ok, true);
  return { lane, close: () => harness.close(context), finish: () => lane.drive({ operationId: "finishing" }, context) };
}

void test("a native operation finishing between reads remains reconnectable", async (t) => {
  const run = await admitted(); t.after(run.close);
  const read = run.lane.getResult.bind(run.lane);
  run.lane.getResult = async (id, ctx) => { const result = await read(id, ctx); await run.finish(); return result; };
  const watch = await watchNativeOperation(run.lane, "finishing", context);
  assert.ok(watch, "the existing operation must not become a false 404 at terminal commit");
  await run.finish();
  assert.match(await nativeWatchResponse(watch, "session", "finishing", new SecretScrub()).text(), /Committed final answer/);
});

void test("terminal events after a native snapshot remain paired with that active snapshot", async (t) => {
  const run = await admitted(); t.after(run.close);
  const observe = run.lane.watch.bind(run.lane);
  run.lane.watch = async (ctx) => { const watch = await observe(ctx); await run.finish(); return watch; };
  const watch = await watchNativeOperation(run.lane, "finishing", context);
  assert.ok(watch);
  assert.match(await nativeWatchResponse(watch, "session", "finishing", new SecretScrub()).text(), /Committed final answer/);
});

void test("an unknown operation has no native watch to expose", async (t) => {
  const run = await admitted(); t.after(run.close);
  const native = await run.lane.watch(context);
  const unsubscribe = t.mock.method(native, "unsubscribe");
  run.lane.watch = () => Promise.resolve(native);
  assert.equal(await watchNativeOperation(run.lane, "unknown", context), undefined);
  assert.equal(unsubscribe.mock.callCount(), 1);
  await run.finish();
});

void test("a failed old-result lookup releases its actual native subscription", async (t) => {
  const run = await admitted(); t.after(run.close);
  const native = await run.lane.watch(context);
  const unsubscribe = t.mock.method(native, "unsubscribe");
  run.lane.watch = () => Promise.resolve(native);
  t.mock.method(run.lane, "getResult", () => Promise.reject(new Error("Storage unavailable")));
  await assert.rejects(watchNativeOperation(run.lane, "older", context), /Storage unavailable/);
  assert.equal(unsubscribe.mock.callCount(), 1);
});

void test("a requested older result restores only its own completed answer", async (t) => {
  const run = await admitted(); t.after(run.close);
  await run.finish();
  assert.equal((await run.lane.accept({ kind: "prompt", prompt: "Next", operationId: "newer" }, context)).ok, true);
  await run.lane.drive({ operationId: "newer" }, context);
  const watch = await watchNativeOperation(run.lane, "finishing", context);
  assert.ok(watch);
  const wire = await nativeWatchResponse(watch, "session", "finishing", new SecretScrub()).text();
  assert.match(wire, /Committed final answer/);
  assert.doesNotMatch(wire, /Newer answer/);
});

void test("a result from a discarded branch cannot replace the visible branch", async (t) => {
  const run = await admitted(); t.after(run.close);
  await run.finish();
  const navigation = await run.lane.navigateTree(null, { summarize: false }, context);
  assert.equal(navigation.ok, true);
  assert.equal((await run.lane.accept({ kind: "prompt", prompt: "Other branch", operationId: "sibling" }, context)).ok, true);
  await run.lane.drive({ operationId: "sibling" }, context);
  assert.equal(await watchNativeOperation(run.lane, "finishing", context), undefined);
});
