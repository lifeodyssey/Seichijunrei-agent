import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { operationMeta, operationResult, type Session } from "@earendil-works/pi-agent-core/harness/session";
import { NeonStorage } from "@animichi/pi-session-neon";
import { bankOperationUsage, lockSettlement, readOperationCharges, refundOperation, type SettlementDatabase } from "./settlement-accounting.ts";

/** Host exclusion covers preparation through drive. The native accept sequence bounds this operation's ledger. */
export async function prepareOperationSettlement(db: SettlementDatabase, session: Session, operationId: string, context: Context) {
  const meta = await session.getValue(operationMeta(operationId), context);
  if (!meta?.value) return false;
  if (meta.value.lane !== "main" || meta.value.intent.kind !== "run") throw new Error("Business settlement requires the main model lane");
  return db.transaction(async (tx) => {
    const row = await lockSettlement(db, tx, session.metadata.id, operationId);
    if (row?.admission.state !== "accepted" || row.settlement.settledAt !== null) return false;
    if (row.settlement.lastUsageSeq === -1) await tx.orm.public.AgentSettlement.where({ operationId }).update({ lastUsageSeq: meta.seq });
    return true;
  });
}

/** Reads real terminal evidence; failed queries or absent cursor leave the independent obligation pending. */
export async function settleModelOperation(db: SettlementDatabase, session: Session, lane: AgentLane, operationId: string, context: Context, now: number) {
  const result = await lane.getResult(operationId, context);
  if (!result) return undefined;
  const terminal = await session.getValue(operationResult(operationId), context);
  if (!terminal?.value || terminal.value.operationId !== result.operationId) throw new Error("Native terminal sequence is unavailable");
  const admission = await db.orm.public.AgentAdmission.where({ operationId, sessionId: session.metadata.id }).first();
  const origin = await db.orm.public.AgentSettlement.where({ operationId }).first();
  if (!admission || !origin || origin.lastUsageSeq === -1) return undefined;
  const storage = new NeonStorage(db, { sessionId: session.metadata.id });
  let charges: Awaited<ReturnType<typeof readOperationCharges>>;
  try { charges = await readOperationCharges(storage, admission.payer, origin.lastUsageSeq, terminal.seq, context); }
  finally { await storage.close(context); }
  return db.transaction(async (tx) => {
    const row = await lockSettlement(db, tx, session.metadata.id, operationId);
    if (!row) return undefined;
    if (row.settlement.settledAt !== null) return result;
    if (row.admission.state !== "accepted") return undefined;
    if (row.settlement.lastUsageSeq !== origin.lastUsageSeq) return undefined;
    if (row.admission.payer !== admission.payer) throw new Error("Admitted payer changed during settlement");
    const at = new Date(now).toISOString();
    if (result.status === "completed" && row.admission.rejectionReason === null) {
      await bankOperationUsage(db, tx, charges, at);
    } else await refundOperation(db, tx, row.admission, at);
    await tx.orm.public.AgentSettlement.where({ operationId }).update({ lastUsageSeq: terminal.seq, settledAt: at });
    await tx.orm.public.AgentAdmission.where({ id: row.admission.id }).update({ state: "settled" });
    await tx.orm.public.AgentOpenOperation.where({ operationId }).deleteAll();
    return result;
  });
}
