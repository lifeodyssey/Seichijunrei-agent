import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import type { AdmissionDatabase } from "../admission/types.ts";
import { reconcileModelAdmission } from "../admission/reconcile-model-admission.ts";
import { prepareOperationSettlement, settleModelOperation } from "../settlement/native-settlement.ts";

/** Every drive reads current native witnesses and establishes its durable ledger origin first. */
export async function prepareModelOperation(db: AdmissionDatabase, session: Session, lane: AgentLane, operationId: string, context: Context) {
  const state = await reconcileModelAdmission(db, lane, context, { sessionId: session.metadata.id, operationId }, Date.now());
  if (state.kind === "terminal") await settleModelOperation(db, session, lane, operationId, context, Date.now());
  if (state.kind !== "running" && state.kind !== "abort") return false;
  if (!await prepareOperationSettlement(db, session, operationId, context)) return false;
  if (state.kind === "abort") {
    const aborted = await lane.requestAbort(operationId, context);
    if (!aborted.ok) throw aborted.error;
  }
  return true;
}
