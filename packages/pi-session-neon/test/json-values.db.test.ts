import assert from "node:assert/strict";
import { test } from "node:test";
import { database, SESSION_ID } from "./postgres.ts";

const ADDRESS = { sessionId: SESSION_ID, namespace: "app", key: "json", seq: 0 };

void test("a native JSONB scalar preserves a root string", async () => {
  await database.orm.public.PiScalarValue.create({ ...ADDRESS, value: "京都" });
  assert.deepEqual(await database.orm.public.PiScalarValue.select("value").all(), [{ value: "京都" }]);
});

void test("a native JSONB numeric-looking string does not become a number", async () => {
  await database.orm.public.PiScalarValue.create({ ...ADDRESS, value: "123" });
  assert.deepEqual(await database.orm.public.PiScalarValue.select("value").all(), [{ value: "123" }]);
});

void test("a native JSONB null-looking string does not become null", async () => {
  await database.orm.public.PiScalarValue.create({ ...ADDRESS, value: "null" });
  assert.deepEqual(await database.orm.public.PiScalarValue.select("value").all(), [{ value: "null" }]);
});

void test("native JSONB numeric and boolean primitives retain their types", async () => {
  await database.orm.public.PiScalarValue.create({ ...ADDRESS, value: 123 });
  await database.orm.public.PiListValue.create({ ...ADDRESS, value: false });
  assert.deepEqual(await database.orm.public.PiScalarValue.select("value").all(), [{ value: 123 }]);
  assert.deepEqual(await database.orm.public.PiListValue.select("value").all(), [{ value: false }]);
});
