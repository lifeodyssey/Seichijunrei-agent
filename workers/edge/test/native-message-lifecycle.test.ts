import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { fixture, harnessFor } from "../../../packages/agent/test/native-tool-fixture.ts";
import { nativeWatchResponse } from "../src/agent/views/watch-response.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";

function textOf(wire: string) {
  const chunks = wire.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as { type: string; delta?: string });
  return chunks.flatMap((chunk) => chunk.type === "text-delta" ? [chunk.delta] : []).join("");
}

void test("distinct native assistant lifecycles with identical timestamps survive live and committed replay", async () => {
  const resources = await fixture(() => Promise.reject(new Error("No catalog request")));
  const { harness } = await harnessFor(resources.toolContext, [fauxAssistantMessage("First response", { timestamp: 0 }), fauxAssistantMessage("Second response", { timestamp: 0 })], []);
  let completed = 0;
  harness.hooks.on("before_run_end", () => { completed += 1; return completed === 1 ? { followUp: "Continue" } : undefined; });
  const lane = await harness.lane("main", context);
  await lane.accept({ kind: "prompt", prompt: "Hello", operationId: "lifecycle" }, context);
  const body = nativeWatchResponse(await lane.watch(context), "session", "lifecycle", new SecretScrub()).text();
  await lane.drive({ operationId: "lifecycle" }, context);
  assert.equal(textOf(await body), "First responseSecond response");
  const replay = nativeWatchResponse(await lane.watch(context), "session", "lifecycle", new SecretScrub());
  assert.equal(textOf(await replay.text()), "First responseSecond response");
  await harness.close(context);
});
