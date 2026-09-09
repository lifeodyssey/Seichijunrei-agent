import assert from "node:assert/strict";
import { test } from "node:test";
import { entry, insertEntry, insertUsage, USAGE } from "./native-records.ts";
import { insertNativeRows, nativeRows } from "./native-batch.ts";
import { database, METADATA, SESSION_ID } from "./postgres.ts";

void test("a native session retains metadata even when its fork source no longer exists", async () => {
  assert.deepEqual(await database.orm.public.PiSession.all(), [{ id: SESSION_ID, nextSeq: 0, metadata: METADATA }]);
});

void test("native entries round-trip their visible parent and nested JSON without transcript conversion", async () => {
  await insertEntry();
  const child = { ...entry("child", 1, "entry"), data: { nested: [null, "京都", { visible: true }] } };
  await insertEntry(child);
  const rows = await database.orm.public.PiRecord.select("payload").orderBy((record) => record.seq.asc()).all();
  assert.deepEqual(rows, [{ payload: entry() }, { payload: child }]);
});

void test("an absent optional native entry payload remains absent after JSON persistence", async () => {
  await insertEntry({ ...entry(), data: undefined });
  const { data: omitted, ...expected } = entry();
  assert.ok(omitted);
  assert.deepEqual(await database.orm.public.PiRecord.select("payload").all(), [{ payload: expected }]);
});

void test("a native record cannot belong to a missing session", async () => {
  await assert.rejects(database.orm.public.PiRecord.create({ sessionId: "missing", id: "entry", seq: 0,
    kind: "entry", payload: { id: "entry", seq: 0 } }), /foreign key constraint/);
  assert.deepEqual(await database.orm.public.PiRecord.all(), []);
});

void test("replaying an entry id fails without changing the original payload", async () => {
  await insertEntry();
  await assert.rejects(insertEntry(entry("entry", 2)), /unique constraint/);
  assert.deepEqual(await database.orm.public.PiRecord.select("payload").all(), [{ payload: entry() }]);
});

void test("entry and usage ids share one namespace in either insertion order", async () => {
  await insertEntry();
  await insertUsage();
  await assert.rejects(insertUsage({ ...USAGE, id: "entry", seq: 2 }), /unique constraint/);
  await assert.rejects(insertEntry(entry("usage", 2)), /unique constraint/);
});

void test("competing entry and usage inserts have one winner", async () => {
  const outcomes = await Promise.allSettled([
    insertEntry(entry("contended")), insertUsage({ ...USAGE, id: "contended" }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal((await database.orm.public.PiRecord.all()).length, 1);
});

void test("usage uniqueness prevents another charge and native usage scans preserve ordering", async () => {
  await insertUsage();
  const later = { ...USAGE, id: "later", seq: 4, adjustment: true };
  await insertUsage(later);
  await assert.rejects(insertUsage({ ...USAGE, seq: 3 }), /unique constraint/);
  const rows = await database.orm.public.PiRecord.where((record) => record.kind.eq("usage"))
    .where((record) => record.seq.gt(1)).select("payload").orderBy((record) => record.seq.asc()).limit(1).all();
  assert.deepEqual(rows, [{ payload: later }]);
});

void test("a later FK failure rolls back every native write and the advanced sequence", async () => {
  await assert.rejects(database.transaction(async (tx) => {
    await insertNativeRows(tx, 0);
    await tx.orm.public.PiSession.where((session) => session.id.eq(SESSION_ID)).update({ nextSeq: 4 });
    await tx.orm.public.PiRecord.create({ sessionId: "missing", id: "failure", seq: 5, kind: "entry", payload: { id: "failure", seq: 5 } });
  }), /foreign key constraint/);
  assert.deepEqual(await nativeRows(), [[], [], [], [{ nextSeq: 0 }]]);
});

void test("two distinct entries cannot occupy the same sequence", async () => {
  await insertEntry();
  await assert.rejects(insertEntry(entry("another", 0)), /unique constraint/);
});

void test("query identifiers cannot contradict their native JSON payload", async () => {
  await assert.rejects(database.orm.public.PiRecord.create({ sessionId: SESSION_ID, id: "entry", seq: 0,
    kind: "entry", payload: { id: "different", seq: 0 } }), /check constraint/);
  await assert.rejects(database.orm.public.PiRecord.create({ sessionId: SESSION_ID, id: "entry", seq: 0,
    kind: "entry", payload: { id: "entry", seq: 9 } }), /check constraint/);
});
