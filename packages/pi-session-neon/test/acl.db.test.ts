import assert from "node:assert/strict";
import { test } from "node:test";
import postgresClient from "@prisma/orm-postgres/runtime";
import contractJson from "../src/contract.json" with { type: "json" };
import type { Contract } from "../src/contract.d.ts";
import { database, pool, postgres, SESSION_ID } from "./postgres.ts";

void test("only the agent service can access native agent tables", async () => {
  const roles = await pool.query("SELECT role, count(*) FILTER (WHERE has_table_privilege(role, name, 'SELECT'))::int AS readable_tables, count(*)::int AS tables FROM unnest(ARRAY['agent_svc','catalog_svc','users_svc','jobs_svc','readonly']) AS role CROSS JOIN unnest(ARRAY['pi_sessions','pi_records','pi_scalar_values','pi_list_values','agent_admissions','agent_open_operations','agent_settlements']) AS name GROUP BY role ORDER BY role");
  assert.deepEqual(roles.rows, [{ role: "agent_svc", readable_tables: 7, tables: 7 }, { role: "catalog_svc", readable_tables: 0, tables: 7 }, { role: "jobs_svc", readable_tables: 0, tables: 7 }, { role: "readonly", readable_tables: 0, tables: 7 }, { role: "users_svc", readable_tables: 0, tables: 7 }]);
});

void test("the agent role can append native records but cannot edit or directly delete history", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN; SET LOCAL ROLE agent_svc");
    await client.query("INSERT INTO pi_records (session_id,id,seq,kind,payload) VALUES ($1,'entry',0,'entry','{\"id\":\"entry\",\"seq\":0}')", [SESSION_ID]);
    await client.query("COMMIT");
    await client.query("BEGIN; SET LOCAL ROLE agent_svc");
    await assert.rejects(client.query("UPDATE pi_records SET seq = 9"), { code: "42501" });
    await client.query("ROLLBACK; BEGIN; SET LOCAL ROLE agent_svc");
    await assert.rejects(client.query("DELETE FROM pi_records"), { code: "42501" });
  } finally { await client.query("ROLLBACK"); client.release(); }
  assert.deepEqual(await database.orm.public.PiRecord.select("id", "seq").all(), [{ id: "entry", seq: 0 }]);
});

void test("the agent service uses the native Prisma runtime with its own database privileges", async () => {
  const url = new URL(postgres.dsn);
  url.searchParams.set("options", "-c role=agent_svc");
  await using agent = postgresClient<Contract>({ contractJson, url: url.href });
  await agent.orm.public.PiScalarValue.create({ sessionId: SESSION_ID, namespace: "app", key: "city", seq: 0, value: { city: "Kyoto" } });
  assert.deepEqual(await agent.orm.public.PiScalarValue.select("value").all(), [{ value: { city: "Kyoto" } }]);
});
