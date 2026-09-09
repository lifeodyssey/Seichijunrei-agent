// Native schema examples; the actual admission/settlement writers belong to #1546/#1550.
import { database, pool, SESSION_ID } from "./postgres.ts";

export const ADMISSION = {
  id: "01992000-0000-7000-8000-000000000001", sessionId: SESSION_ID,
  clientMessageId: "client", kind: "model", operationId: "operation",
  identityId: "visitor", payer: "anon", requestDigest: "digest",
} as const;
export const DAY = "2026-09-09";
export const STAMP = "2026-09-09T00:00:00Z";

export function insertAdmission() {
  return database.orm.public.AgentAdmission.create(ADMISSION);
}

export async function acceptedReservation() {
  await insertAdmission();
  await database.orm.public.AgentAdmission.where((row) => row.id.eq(ADMISSION.id))
    .update({ state: "accepted", quotaUsageDate: DAY, quotaReservedAt: STAMP });
  await pool.query("INSERT INTO anon_daily_message_count (usage_date, anon_id, message_count) VALUES ($1, 'visitor', 1)", [DAY]);
  await database.orm.public.AgentOpenOperation.create({ operationId: "operation" });
  await database.orm.public.AgentSettlement.create({ operationId: "operation" });
}

export async function businessBalances() {
  return Promise.all([
    database.orm.public.AgentSettlement.all(),
    pool.query<{ requests: string; cost: string }>("SELECT requests, cost_usd AS cost FROM daily_usage WHERE usage_date = $1", [DAY]).then((result) => result.rows),
    pool.query<{ count: string }>("SELECT message_count AS count FROM anon_daily_message_count WHERE usage_date = $1", [DAY]).then((result) => result.rows),
    database.orm.public.AgentAdmission.select("state", "quotaRefundedAt").all(),
  ]);
}
