import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";
import { createCleanDatabase } from "@animichi/test-postgres";
import pg from "pg";
import contractJson from "../src/contract.json" with { type: "json" };
import { futureContract } from "./migration-fixtures.ts";
import { migrate } from "./prisma-migration.ts";
import { postgres } from "./postgres.ts";

void test("selecting artifact B while checkout is C applies only B and replay preserves its marker and data", async () => {
  const directory = await futureContract();
  const dsn = await createCleanDatabase(postgres.dsn, "native_artifact_target");
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    await migrate(dsn, directory, contractJson.storage.storageHash);
    await client.query("INSERT INTO pi_sessions (id, metadata) VALUES ('preserved', '{\"id\":\"preserved\"}')");
    assert.deepEqual((await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'pi_sessions' ORDER BY 1")).rows,
      [{ column_name: "id" }, { column_name: "metadata" }, { column_name: "next_seq" }]);
    const marker = (await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows;
    const replay = await migrate(dsn, directory, contractJson.storage.storageHash);
    assert.match(replay.stdout, /"migrationsApplied":0/);
    assert.deepEqual((await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows, marker);
    assert.deepEqual((await client.query("SELECT id FROM pi_sessions")).rows, [{ id: "preserved" }]);
    await migrate(dsn, directory);
    const currentMarker = (await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows;
    await assert.rejects(migrate(dsn, directory, contractJson.storage.storageHash), { stdout: /MIGRATION.PATH_UNREACHABLE/ });
    assert.deepEqual((await client.query("SELECT * FROM prisma_contract.marker ORDER BY 1")).rows, currentMarker);
    assert.deepEqual((await client.query("SELECT future_field FROM pi_sessions")).rows, [{ future_field: null }]);
  } finally { await client.end(); await rm(directory, { recursive: true, force: true }); }
});

void test("a conflicting pre-existing Pi table is refused without adoption or partial creation", async () => {
  const dsn = await createCleanDatabase(postgres.dsn, "native_conflict_refusal");
  const client = new pg.Client({ connectionString: dsn });
  await client.connect();
  try {
    await client.query("CREATE TABLE pi_records (legacy_value text); INSERT INTO pi_records VALUES ('preserved')");
    await assert.rejects(migrate(dsn));
    assert.deepEqual((await client.query("SELECT * FROM pi_records")).rows, [{ legacy_value: "preserved" }]);
    assert.deepEqual((await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows, [{ tablename: "pi_records" }]);
  } finally { await client.end(); }
});
