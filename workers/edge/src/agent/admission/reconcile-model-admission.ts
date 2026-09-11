import type { AgentLane, CurrentOperationInfo } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { OperationResultRecord } from "@earendil-works/pi-agent-core/harness/session";
import { ensureAcceptedObligations } from "./accepted-obligations.ts";
import { voidUnacceptedAdmission } from "./void-unaccepted.ts";
import type { AdmissionDatabase, AdmissionRecord } from "./types.ts";

export interface ModelOperation { readonly sessionId: string; readonly operationId: string }
export type ReconciledAdmission =
  | { kind: "running" | "abort" | "void" | "settled" | "pending" | "missing"; operationId: string }
  | { kind: "terminal"; operationId: string; result: OperationResultRecord };
interface Witnesses { current: CurrentOperationInfo | null; result: OperationResultRecord | undefined }

async function observe(lane: AgentLane, context: Context, operationId: string): Promise<Witnesses> {
  const current = (await lane.inspectExecution(context)).current;
  const result = await lane.getResult(operationId, context);
  return { current, result };
}

async function reconcileObserved(db: AdmissionDatabase, row: AdmissionRecord, operationId: string, witness: Witnesses, now: number): Promise<ReconciledAdmission> {
  if (witness.current?.id === operationId || witness.result) {
    await ensureAcceptedObligations(db, row);
    if (witness.result) return { kind: "terminal", operationId, result: witness.result };
    return { kind: row.rejectionReason === null ? "running" : "abort", operationId };
  }
  const voided = row.state === "pending" && await voidUnacceptedAdmission(db, row, now);
  return { kind: voided ? "void" : "pending", operationId };
}

/** Host owns exclusion and a successful reattachment. Query failures deliberately propagate. */
export async function reconcileModelAdmission(
  db: AdmissionDatabase, lane: AgentLane, context: Context, operation: ModelOperation, now: number,
): Promise<ReconciledAdmission> {
  const row = await db.orm.public.AgentAdmission.where(operation).first();
  if (!row) return { kind: "missing", operationId: operation.operationId };
  if (row.state === "settled" || row.state === "void") return { kind: row.state, operationId: operation.operationId };
  return reconcileObserved(db, row, operation.operationId, await observe(lane, context, operation.operationId), now);
}
