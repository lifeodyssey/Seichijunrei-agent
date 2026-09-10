import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { lockOwnedConversation } from "../admission/session-owner.ts";
import { persistPermanentRejection } from "../admission/permanent-rejection.ts";
import type { AdmissionDatabase, AdmissionTransaction } from "../admission/types.ts";

export function anonymousBudgetAvailable(db: AdmissionDatabase, tx: AdmissionTransaction, limit: number, now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  return tx.query(db.raw.sql`SELECT coalesce(sum(cost_usd), 0) < ${limit}::numeric AS available
    FROM daily_usage WHERE usage_date = ${day}::date AND scope = 'anon'`.returnsRow({ available: "pg/bool@1" }).build());
}

/** Business truth is re-read before drive/tool effects; deleted conversations are never recreated. */
export async function operationAuthority(db: AdmissionDatabase, sessionId: string, operationId: string, budget: number, context: Context) {
  context.abortSignal?.throwIfAborted();
  return db.transaction(async (tx) => {
    const row = await tx.orm.public.AgentAdmission.where({ sessionId, operationId }).first();
    if (row?.state !== "accepted" || !await lockOwnedConversation(db, tx, row)) return "unavailable";
    if (row.rejectionReason !== null) return "rejected";
    if (row.payer !== "anon") return "allowed";
    if (row.quotaReservedAt === null || row.quotaRefundedAt !== null) return "unavailable";
    return (await anonymousBudgetAvailable(db, tx, budget, Date.now()))[0]?.available ? "allowed" : "quota_exhausted";
  });
}

/** Every tool uses the model admission's existing reservation; replay never increments it again. */
export async function requireToolAuthority(db: AdmissionDatabase, sessionId: string, operationId: string, budget: number, context: Context) {
  const authority = await operationAuthority(db, sessionId, operationId, budget, context);
  if (authority === "allowed") return;
  if (authority === "quota_exhausted") await persistPermanentRejection(db, { sessionId, operationId }, authority);
  throw new Error("The operation is not authorized to execute a tool");
}
