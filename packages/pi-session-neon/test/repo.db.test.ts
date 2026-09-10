import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { StorageBackedSession } from "@earendil-works/pi-agent-core/harness/session";
import { NeonSessionRepo } from "@animichi/pi-session-neon";
import { database, METADATA, SESSION_ID } from "./postgres.ts";

void test("create, open and fork return the public SDK Session class", async () => {
  const repo = new NeonSessionRepo(database);
  const created = await repo.create({ parentSessionId: "retired" }, BACKGROUND_CONTEXT);
  assert(created instanceof StorageBackedSession);
  assert.equal(created.metadata.parentSessionId, "retired");
  const forked = await repo.fork(created.metadata, { scope: "tree" }, BACKGROUND_CONTEXT);
  assert(forked instanceof StorageBackedSession);
  assert.notEqual(created.metadata.id, forked.metadata.id);
  await created.close(BACKGROUND_CONTEXT);
  const reopened = await repo.open({ ...created.metadata, createdAt: -1 }, BACKGROUND_CONTEXT);
  assert(reopened instanceof StorageBackedSession);
  assert.deepEqual(reopened.metadata, created.metadata);
  await Promise.all([reopened.close(BACKGROUND_CONTEXT), forked.close(BACKGROUND_CONTEXT)]);
});

void test("failed open releases ownership for a later session with that id", async () => {
  const repo = new NeonSessionRepo(database);
  await assert.rejects(repo.open({ ...METADATA, id: "absent" }, BACKGROUND_CONTEXT), /Unknown session/);
  const created = await repo.create({ id: "absent" }, BACKGROUND_CONTEXT);
  await created.close(BACKGROUND_CONTEXT);
});

void test("stored versions are checked before opening and do not leak reservations", async () => {
  const repo = new NeonSessionRepo(database);
  await database.orm.public.PiSession.where({ id: SESSION_ID }).update({ metadata: { ...METADATA, storageVersion: 2 } });
  await assert.rejects(repo.open(METADATA, BACKGROUND_CONTEXT), /Unsupported session storage version: 2/);
  await database.orm.public.PiSession.where({ id: SESSION_ID }).update({ metadata: METADATA });
  const session = await repo.open(METADATA, BACKGROUND_CONTEXT);
  await session.close(BACKGROUND_CONTEXT);
});

void test("a failed fork of an absent source leaves its destination reusable", async () => {
  const repo = new NeonSessionRepo(database);
  await assert.rejects(repo.fork({ ...METADATA, id: "absent" }, { id: "destination", scope: "tree" }, BACKGROUND_CONTEXT), /Unknown session/);
  const created = await repo.create({ id: "destination" }, BACKGROUND_CONTEXT);
  await created.close(BACKGROUND_CONTEXT);
});

void test("deletion refuses an absent session and releases its temporary reservation", async () => {
  const repo = new NeonSessionRepo(database);
  await assert.rejects(repo.delete({ ...METADATA, id: "absent" }, BACKGROUND_CONTEXT), /Unknown session/);
  const created = await repo.create({ id: "absent" }, BACKGROUND_CONTEXT);
  await created.close(BACKGROUND_CONTEXT);
  await repo.delete(created.metadata, BACKGROUND_CONTEXT);
});
