import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMISSION, insertAdmission, STAMP } from "./business-records.ts";
import { reserve } from "./business-transactions.ts";
import { database, pool } from "./postgres.ts";

void test("a model admission allocates the operation before quota reservation", async () => {
  await insertAdmission();
  const rows = await database.orm.public.AgentAdmission.select("operationId", "state", "quotaReservedAt").all();
  assert.deepEqual(rows, [{ operationId: "operation", state: "pending", quotaReservedAt: null }]);
});

void test("a lost admission response cannot allocate another operation or reserve twice", async () => {
  await insertAdmission();
  await assert.rejects(database.orm.public.AgentAdmission.create({ ...ADMISSION, id: undefined, operationId: "replay" }));
  await database.runtime().execute(reserve());
  await database.runtime().execute(reserve());
  assert.deepEqual(await database.orm.public.AgentAdmission.select("operationId").all(), [{ operationId: "operation" }]);
  assert.deepEqual((await pool.query("SELECT message_count AS count FROM anon_daily_message_count")).rows, [{ count: "1" }]);
});

void test("selection intents use the same request key without a fabricated operation", async () => {
  await database.orm.public.AgentAdmission.create({ ...ADMISSION, kind: "selection", operationId: null, selectionRequest: { of: "points", pointIds: ["point"], origin: null, locale: "en" } });
  const rows = await database.orm.public.AgentAdmission.select("kind", "operationId", "selectionRequest").all();
  assert.deepEqual(rows, [{ kind: "selection", operationId: null, selectionRequest: { of: "points", pointIds: ["point"], origin: null, locale: "en" } }]);
  await assert.rejects(pool.query("UPDATE agent_admissions SET operation_id = 'fake'"), { code: "23514" });
});

void test("a model admission cannot lose its stable operation id", async () => {
  await insertAdmission();
  await assert.rejects(pool.query("UPDATE agent_admissions SET operation_id = NULL"), { code: "23514" });
});

void test("admission state accepts only the four business states", async () => {
  await insertAdmission();
  await pool.query("UPDATE agent_admissions SET state = 'accepted'");
  await pool.query("UPDATE agent_admissions SET state = 'settled'");
  await pool.query("UPDATE agent_admissions SET state = 'void'");
  await assert.rejects(pool.query("UPDATE agent_admissions SET state = 'running'"), { code: "23514" });
});

void test("a reservation requires both its original quota date and reservation marker", async () => {
  await insertAdmission();
  await assert.rejects(pool.query("UPDATE agent_admissions SET quota_reserved_at = $1", [STAMP]), { code: "23514" });
  await assert.rejects(pool.query("UPDATE agent_admissions SET quota_usage_date = '2026-09-09'"), { code: "23514" });
});

void test("a refund cannot exist without a reservation", async () => {
  await insertAdmission();
  await assert.rejects(pool.query("UPDATE agent_admissions SET quota_refunded_at = $1", [STAMP]), { code: "23514" });
});

void test("selection and caller-key requests cannot reserve anonymous message quota", async () => {
  await database.orm.public.AgentAdmission.create({ ...ADMISSION, kind: "selection", operationId: null, selectionRequest: { of: "points", pointIds: ["point"], origin: null, locale: "en" } });
  await assert.rejects(pool.query("UPDATE agent_admissions SET quota_usage_date = '2026-09-09', quota_reserved_at = $1", [STAMP]), { code: "23514" });
  await pool.query("UPDATE agent_admissions SET kind = 'model', operation_id = 'operation', payer = 'byok', selection_request = NULL");
  await assert.rejects(pool.query("UPDATE agent_admissions SET quota_usage_date = '2026-09-09', quota_reserved_at = $1", [STAMP]), { code: "23514" });
});
