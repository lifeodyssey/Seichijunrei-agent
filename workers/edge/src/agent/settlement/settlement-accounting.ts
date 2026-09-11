import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Storage } from "@earendil-works/pi-agent-core/harness/session";
import { chargeUsage } from "./usage-charge.ts";

export type SettlementDatabase = PostgresClient<Contract>;
type Transaction = Parameters<Parameters<SettlementDatabase["transaction"]>[0]>[0];
type Admission = NonNullable<Awaited<ReturnType<SettlementDatabase["orm"]["public"]["AgentAdmission"]["first"]>>>;
type Settlement = NonNullable<Awaited<ReturnType<SettlementDatabase["orm"]["public"]["AgentSettlement"]["first"]>>>;
interface Obligation { admission: Admission; settlement: Settlement }
const CHARGE_COLUMNS = { scope: "pg/text@1", requests: "pg/int8number@1", input_tokens: "pg/int8number@1", output_tokens: "pg/int8number@1", cost_usd: "pg/text@1" } as const;

export async function lockSettlement(db: SettlementDatabase, tx: Transaction, sessionId: string, operationId: string): Promise<Obligation | undefined> {
  const plan = db.raw.sql`SELECT s.operation_id FROM agent_settlements s JOIN agent_admissions a USING (operation_id)
    WHERE s.operation_id = ${operationId} AND a.session_id = ${sessionId} FOR UPDATE OF a, s`
    .returnsRow({ operation_id: "pg/text@1" }).build();
  if ((await tx.query(plan)).length === 0) return undefined;
  const admission = await tx.orm.public.AgentAdmission.where({ operationId }).first();
  const settlement = await tx.orm.public.AgentSettlement.where({ operationId }).first();
  if (!admission || !settlement) throw new Error("Locked settlement obligation disappeared");
  return { admission, settlement };
}

export async function refundOperation(db: SettlementDatabase, tx: Transaction, admission: Admission, at: string) {
  if (admission.quotaReservedAt === null || admission.quotaRefundedAt !== null) return;
  if (admission.quotaUsageDate === null) throw new Error("Reserved quota has no original usage day");
  await tx.execute(db.raw.sql`UPDATE anon_daily_message_count SET message_count = greatest(message_count - 1, 0), updated_at = now()
    WHERE usage_date = ${admission.quotaUsageDate}::date AND anon_id = ${admission.identityId}`.affectedCount().build());
  await tx.orm.public.AgentAdmission.where({ id: admission.id }).update({ quotaRefundedAt: at });
}

/** Read immutable bounded evidence before acquiring the business transaction's connection. */
export async function readOperationCharges(storage: Storage, payer: string, fromSeq: number, endSeq: number, context: Context) {
  const charges: ReturnType<typeof chargeUsage>[] = [];
  let cursor = fromSeq;
  for (;;) {
    const usage = await storage.scanUsage({ fromSeq: cursor + 1, toSeq: endSeq, order: "asc", limit: 50 }, context);
    if (usage.length === 0) return charges;
    const entries = await storage.getEntries(usage.flatMap((item) => item.entryId ? [item.entryId] : []), context);
    for (const item of usage) {
      charges.push(chargeUsage(item, item.entryId ? entries.get(item.entryId) : undefined, payer));
      cursor = item.seq;
    }
  }
}

/** Successful operations meter native call costs; failed/refused operations retain the existing refund-only policy. */
export async function bankOperationUsage(db: SettlementDatabase, tx: Transaction, charges: ReturnType<typeof chargeUsage>[], at: string) {
  const [first, ...rest] = charges.map((charge) => db.raw.sql`SELECT ${charge.scope} AS scope, ${charge.requests}::bigint AS requests,
    ${charge.inputTokens}::bigint AS input_tokens, ${charge.outputTokens}::bigint AS output_tokens, ${charge.costUsd} AS cost_usd`.returnsRow(CHARGE_COLUMNS));
  if (!first) return;
  const recorded = rest.reduce((rows, row) => db.raw.sql`${rows} UNION ALL ${row}`.returnsRow(CHARGE_COLUMNS), first);
  // Sum recorded decimals before the destination rounds once to NUMERIC(14,6); never reprice aggregate tokens.
  await tx.execute(db.raw.sql`INSERT INTO daily_usage (usage_date, scope, requests, input_tokens, output_tokens, cost_usd, updated_at)
    SELECT ${at.slice(0, 10)}::date, scope, sum(requests), sum(input_tokens), sum(output_tokens), sum(cost_usd::numeric), ${at}::timestamptz
    FROM (${recorded}) AS native_calls GROUP BY scope
    ON CONFLICT (usage_date, scope) DO UPDATE SET requests = daily_usage.requests + excluded.requests,
    input_tokens = daily_usage.input_tokens + excluded.input_tokens, output_tokens = daily_usage.output_tokens + excluded.output_tokens,
    cost_usd = daily_usage.cost_usd + excluded.cost_usd, updated_at = excluded.updated_at`.affectedCount().build());
}
