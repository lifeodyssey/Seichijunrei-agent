import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/pi-agent-core/harness/context";
import type { SessionMutationCallback, Write } from "@earendil-works/pi-agent-core/harness/session";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { searchBangumi } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

void test("after a crash the native safe replay checks revoked authorization before repeating catalog work", async () => {
  let calls = 0;
  const { repo, session, toolContext } = await fixture(() => { calls += 1; return Promise.resolve(Response.json({ rows: [], synced_at: "today" })); });
  const reserveIds: string[] = [];
  toolContext.reserveToolUsage = (id) => { reserveIds.push(id); return Promise.resolve(); };
  const mutate = session.mutate.bind(session);
  const failure = mock.method(session, "mutate", <T>(callback: SessionMutationCallback<T>, context: Context) =>
    mutate((mutator, inside) => {
      const commit = mutator.commit.bind(mutator);
      mock.method(mutator, "commit", (writes: Write[], current: Context) => calls ? Promise.reject(new Error("simulated storage loss")) : commit(writes, current));
      return callback(mutator, inside);
    }, context));
  const first = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "123" }), { stopReason: "toolUse" })], [searchBangumi]);
  const lane = await first.harness.lane("main", BACKGROUND_CONTEXT);
  await assert.rejects(lane.prompt("Search", undefined, BACKGROUND_CONTEXT));
  assert.equal(calls, 1);
  failure.mock.restore();
  await first.harness.close(BACKGROUND_CONTEXT);
  const reopened = await repo.open(session.metadata, BACKGROUND_CONTEXT);
  let authorizations = 0;
  toolContext.session = reopened;
  toolContext.assertAuthorized = () => { authorizations += 1; return Promise.reject(new Error("authorization revoked")); };
  const restored = await harnessFor(toolContext, [fauxAssistantMessage("Access revoked.")], [searchBangumi]);
  const open = restored.open[0];
  assert.ok(open);
  await (await restored.harness.lane("main", BACKGROUND_CONTEXT)).drive({ operationId: open.operationId, waitForRetry: false }, BACKGROUND_CONTEXT);
  assert.equal(authorizations, 1);
  assert.equal(calls, 1);
  assert.equal(reserveIds.length, 1);
  await restored.harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
