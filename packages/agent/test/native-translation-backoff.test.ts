import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { BACKGROUND_CONTEXT, withCancel } from "@earendil-works/pi-agent-core/harness/context";
import { translateAnimeTitle } from "@animichi/agent/tools";
import { fixture } from "./native-tool-fixture.ts";
import { catalogClock, pendingCatalog } from "./catalog-clock.ts";

void test("translation observes caller cancellation while the official catalog retry is waiting", async (context) => {
  catalogClock(context);
  const catalog = pendingCatalog(1);
  const { repo, toolContext } = await fixture(catalog.fetch);
  context.after(async () => { context.mock.timers.runAll(); await repo.close(BACKGROUND_CONTEXT); });
  const caller = withCancel(BACKGROUND_CONTEXT);
  const invocation = { invocationId: "translation", operationId: "operation", turnId: "turn",
    getMemo: () => Promise.resolve(undefined), setMemo: () => Promise.resolve() };
  let finished = false;
  const executed = translateAnimeTitle.execute("call", { title: "Title", target_language: "zh" }, () => undefined,
    toolContext, invocation, caller.context).catch((error: unknown) => { finished = true; return error; });
  const first = await catalog.received(0);
  first.respond(new Response("Unavailable", { status: 503 }));
  await setImmediate();
  caller.cancel(new DOMException("Translation cancelled", "AbortError"));
  await setImmediate();
  const finishedBeforeBackoff = finished;
  context.mock.timers.tick(2_000);
  const error: unknown = await executed;
  assert.ok(error instanceof DOMException);
  assert.equal(error.name, "AbortError");
  assert.equal(first.request.signal.aborted, true);
  assert.equal(finishedBeforeBackoff, true, "Cancellation must not wait for a new catalog attempt");
});
