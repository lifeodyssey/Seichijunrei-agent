import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { database, METADATA, SESSION_ID } from "./postgres.ts";
import { entry } from "./native-records.ts";

void test("a fork rejects a stored dangling parent through native Pi validation before creating its destination", async () => {
  const record = entry("dangling", 0, "missing");
  await database.orm.public.PiRecord.create({ sessionId: SESSION_ID, id: record.id, seq: record.seq,
    kind: "entry", payload: { ...record } });
  const repo = new NeonSessionRepo(database);
  await assert.rejects(repo.fork(METADATA, { id: "invalid-fork", scope: "tree" }, BACKGROUND_CONTEXT), /parent/i);
  assert.equal(await database.orm.public.PiSession.first({ id: "invalid-fork" }), null);
  const recovered = await repo.create({ id: "invalid-fork" }, BACKGROUND_CONTEXT);
  await recovered.close(BACKGROUND_CONTEXT);
});
