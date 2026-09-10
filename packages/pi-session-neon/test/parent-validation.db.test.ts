import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { insertEntry } from "@earendil-works/pi-agent-core/harness/session";
import { NeonStorage } from "@animichi/pi-session-neon";
import { database, serviceDatabase, METADATA, SESSION_ID } from "./postgres.ts";

void test("an absent parent fails before insertion rather than accepting a forward reference", async () => {
  const storage = new NeonStorage(serviceDatabase, { sessionId: SESSION_ID });
  await assert.rejects(storage.commit([
    insertEntry({ id: "child", parentId: "future", type: "custom", customType: "invalid" }),
    insertEntry({ id: "future", parentId: null, type: "custom", customType: "future" }),
  ], BACKGROUND_CONTEXT), /parent/i);
  assert.deepEqual(await database.orm.public.PiRecord.all(), []);
  assert.deepEqual(await database.orm.public.PiSession.select("nextSeq").all(), [{ nextSeq: 0 }]);
  await storage.close(BACKGROUND_CONTEXT);
});

void test("a parent from another session is not visible", async () => {
  const source = new NeonStorage(serviceDatabase, { sessionId: SESSION_ID });
  await source.commit([insertEntry({ id: "parent", parentId: null, type: "custom", customType: "source" })], BACKGROUND_CONTEXT);
  await database.orm.public.PiSession.create({ id: "other", metadata: { ...METADATA, id: "other" } });
  const other = new NeonStorage(serviceDatabase, { sessionId: "other" });
  await assert.rejects(other.commit([insertEntry({ id: "child", parentId: "parent", type: "custom", customType: "invalid" })], BACKGROUND_CONTEXT), /parent/i);
  assert.deepEqual(await database.orm.public.PiRecord.where({ sessionId: "other" }).all(), []);
  await Promise.all([source.close(BACKGROUND_CONTEXT), other.close(BACKGROUND_CONTEXT)]);
});
