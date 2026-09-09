import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteList, deleteValue, list, value } from "@earendil-works/pi-agent-core/harness/session";
import { nativeMultiwrite } from "./native-batch.ts";
import { database, SESSION_ID } from "./postgres.ts";

const ADDRESS = { sessionId: SESSION_ID, namespace: "app", key: "settings" };

void test("one native multiwrite stores entries, scalars, list elements and usage atomically", async () => {
  assert.deepEqual(await nativeMultiwrite(), { firstSeq: 0, seqs: [0, 1, 2, 3], timestamp: 123 });
  assert.deepEqual(await database.orm.public.PiRecord.select("seq").orderBy((row) => row.seq.asc()).all(), [{ seq: 0 }, { seq: 3 }]);
  assert.deepEqual(await database.orm.public.PiScalarValue.select("seq").all(), [{ seq: 1 }]);
  assert.deepEqual(await database.orm.public.PiListValue.select("seq").all(), [{ seq: 2 }]);
  assert.deepEqual(await database.orm.public.PiSession.select("nextSeq").all(), [{ nextSeq: 4 }]);
});

void test("a stored null retains an address that is distinct from absence", async () => {
  assert.deepEqual(await database.orm.public.PiScalarValue.all(), []);
  await database.orm.public.PiScalarValue.create({ ...ADDRESS, seq: 0, value: null });
  assert.deepEqual(await database.orm.public.PiScalarValue.all(), [{ ...ADDRESS, seq: 0, value: null }]);
});

void test("a scalar replacement retains its new sequence and nested JSON value", async () => {
  await database.orm.public.PiScalarValue.create({ ...ADDRESS, seq: 0, value: { city: "before" } });
  const replacement = { city: "京都", nested: [null, true, 7] };
  await database.orm.public.PiScalarValue.where((row) => row.key.eq(ADDRESS.key)).update({ seq: 1, value: replacement });
  assert.deepEqual(await database.orm.public.PiScalarValue.select("value", "seq").all(), [{ value: replacement, seq: 1 }]);
});

void test("native list cursors return ordered elements and preserve null", async () => {
  await database.orm.public.PiListValue.create({ ...ADDRESS, seq: 9, value: { city: "Osaka" } });
  await database.orm.public.PiListValue.create({ ...ADDRESS, seq: 2, value: { city: "Kyoto" } });
  await database.orm.public.PiListValue.create({ ...ADDRESS, seq: 5, value: null });
  const rows = await database.orm.public.PiListValue.select("seq", "value")
    .orderBy((row) => row.seq.asc()).cursor({ seq: 2 }).limit(1).all();
  assert.deepEqual(rows, [{ seq: 5, value: null }]);
});

void test("deleting a scalar does not erase a list at the same address", async () => {
  await database.orm.public.PiScalarValue.create({ ...ADDRESS, seq: 0, value: null });
  await database.orm.public.PiListValue.create({ ...ADDRESS, seq: 1, value: null });
  const deletion = deleteValue(value("app", "settings"));
  await database.orm.public.PiScalarValue.where((row) => row.namespace.eq(deletion.namespace)).where((row) => row.key.eq(deletion.key)).delete();
  assert.deepEqual(await database.orm.public.PiScalarValue.all(), []);
  assert.equal((await database.orm.public.PiListValue.all()).length, 1);
});

void test("deleting a list leaves another address and its scalar intact", async () => {
  await database.orm.public.PiScalarValue.create({ ...ADDRESS, seq: 0, value: null });
  await database.orm.public.PiListValue.create({ ...ADDRESS, seq: 1, value: null });
  await database.orm.public.PiListValue.create({ ...ADDRESS, key: "cities", seq: 2, value: { city: "Kyoto" } });
  const deletion = deleteList(list("app", "cities"));
  await database.orm.public.PiListValue.where((row) => row.namespace.eq(deletion.namespace)).where((row) => row.key.eq(deletion.key)).delete();
  assert.deepEqual(await database.orm.public.PiListValue.select("key").all(), [{ key: "settings" }]);
  assert.equal((await database.orm.public.PiScalarValue.all()).length, 1);
});
