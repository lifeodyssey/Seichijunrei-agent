import assert from "node:assert/strict";
import { test } from "node:test";
import { TABLE_CATALOG, type TableShape } from "./catalog.ts";
import { oldTables, pool, postgres } from "./postgres.ts";
import { migrate } from "./prisma-migration.ts";

void test("the expansion preserves every old table, column, constraint, index, trigger and grant", async () => {
  const names = new Set(oldTables.map((table) => table.name));
  const after = (await pool.query<TableShape>(TABLE_CATALOG)).rows.filter((table) => names.has(table.name));
  assert.ok(names.has("runs") && names.has("messages") && names.has("run_steps"));
  assert.deepEqual(after, oldTables);
});

void test("native migration replay preserves pre-existing data", async () => {
  const before = (await pool.query("SELECT * FROM daily_usage WHERE usage_date = '2026-09-08'")).rows;
  await migrate(postgres.dsn);
  assert.deepEqual((await pool.query("SELECT * FROM daily_usage WHERE usage_date = '2026-09-08'")).rows, before);
  assert.equal(before.length, 1);
});
