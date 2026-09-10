import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { appendList, insertEntry, list, setValue, value } from "@earendil-works/pi-agent-core/harness/session";
import { NeonSessionRepo, NeonStorage } from "@animichi/pi-session-neon";
import { database, pool, SESSION_ID } from "./postgres.ts";

const address = value<string>("app", "atomic");
const events = list<string>("app", "events");
const invalidJson = value<string>("app", "invalid-json");

void test("a PostgreSQL JSONB failure rolls back prior scalar, list and entry writes and sequence", async () => {
  const storage = new NeonStorage(database, { sessionId: SESSION_ID });
  await storage.commit([setValue(address, "original")], BACKGROUND_CONTEXT);
  const failure = storage.commit([setValue(address, "changed"), appendList(events, "event"),
    insertEntry({ id: "rolled-back", parentId: null, type: "custom", customType: "atomic" }),
    setValue(invalidJson, "\0")], BACKGROUND_CONTEXT);
  await assert.rejects(failure, (error: unknown) => {
    assert(error instanceof Error);
    assert.match(error.message, /unsupported Unicode escape sequence|22P05/);
    return true;
  });
  assert.equal((await storage.getValue(address, BACKGROUND_CONTEXT))?.value, "original");
  assert.deepEqual(await storage.readList(events, undefined, BACKGROUND_CONTEXT), []);
  assert.deepEqual(await storage.getEntries(["rolled-back"], BACKGROUND_CONTEXT), new Map());
  const committed = await storage.commit([setValue(address, "recovered")], BACKGROUND_CONTEXT);
  assert.equal(committed.firstSeq, 1);
  await storage.close(BACKGROUND_CONTEXT);
});

void test("a PostgreSQL fork failure removes the destination and releases its reservation", async () => {
  const repo = new NeonSessionRepo(database);
  const source = await repo.create({ id: "fork-source" }, BACKGROUND_CONTEXT);
  await source.setValue(address, "source", BACKGROUND_CONTEXT);
  await pool.query(`CREATE FUNCTION reject_fork_value() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fork SQL fault' USING ERRCODE = 'P0001'; END $$`);
  await pool.query(`CREATE TRIGGER reject_fork_value BEFORE INSERT ON pi_scalar_values
    FOR EACH ROW WHEN (NEW.session_id = 'rollback-fork') EXECUTE FUNCTION reject_fork_value()`);
  try {
    await assert.rejects(repo.fork(source.metadata, { id: "rollback-fork", scope: "tree" }, BACKGROUND_CONTEXT),
      (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /fork SQL fault|P0001/);
        return true;
      });
    assert.equal((await repo.list(undefined, BACKGROUND_CONTEXT)).some(({ id }) => id === "rollback-fork"), false);
  } finally {
    await pool.query("DROP TRIGGER reject_fork_value ON pi_scalar_values");
    await pool.query("DROP FUNCTION reject_fork_value()");
  }
  const recovered = await repo.create({ id: "rollback-fork" }, BACKGROUND_CONTEXT);
  assert.equal((await source.getValue(address, BACKGROUND_CONTEXT))?.value, "source");
  await Promise.all([source.close(BACKGROUND_CONTEXT), recovered.close(BACKGROUND_CONTEXT)]);
});

void test("separate Storage handles serialize against PostgreSQL's session row", async () => {
  const left = new NeonStorage(database, { sessionId: SESSION_ID });
  const right = new NeonStorage(database, { sessionId: SESSION_ID });
  const commits = await Promise.all([
    left.commit([appendList(events, "left")], BACKGROUND_CONTEXT),
    right.commit([appendList(events, "right")], BACKGROUND_CONTEXT),
  ]);
  assert.deepEqual(commits.map(({ firstSeq }) => firstSeq).sort(), [0, 1]);
  assert.equal((await left.readList(events, undefined, BACKGROUND_CONTEXT)).length, 2);
  assert.deepEqual(await database.orm.public.PiSession.select("nextSeq").all(), [{ nextSeq: 2 }]);
  await Promise.all([left.close(BACKGROUND_CONTEXT), right.close(BACKGROUND_CONTEXT)]);
});
