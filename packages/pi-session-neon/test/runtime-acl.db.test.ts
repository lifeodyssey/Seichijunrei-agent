import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { insertEntry, insertUsage } from "@earendil-works/pi-agent-core/harness/session";
import { NeonSessionRepo, NeonStorage } from "@animichi/pi-session-neon";
import { serviceDatabase, servicePool, SESSION_ID } from "./postgres.ts";
import { USAGE } from "./native-records.ts";

void test("the application role runs native commits but cannot rewrite historical entries or usage", async () => {
  assert.deepEqual((await servicePool.query<{ current_user: string }>("SELECT current_user")).rows,
    [{ current_user: "agent_svc" }]);
  const storage = new NeonStorage(serviceDatabase, { sessionId: SESSION_ID });
  await storage.commit([
    insertEntry({ id: "entry", parentId: null, type: "custom", customType: "acl" }),
    insertUsage(USAGE),
  ], BACKGROUND_CONTEXT);
  await assert.rejects(servicePool.query("UPDATE pi_records SET payload = payload WHERE session_id = $1", [SESSION_ID]), { code: "42501" });
  await assert.rejects(servicePool.query("DELETE FROM pi_records WHERE session_id = $1", [SESSION_ID]), { code: "42501" });
  await storage.close(BACKGROUND_CONTEXT);
  const repo = new NeonSessionRepo(serviceDatabase);
  const [metadata] = await repo.list(undefined, BACKGROUND_CONTEXT);
  assert(metadata);
  await repo.delete(metadata, BACKGROUND_CONTEXT);
  assert.deepEqual(await repo.list(undefined, BACKGROUND_CONTEXT), []);
});
