import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection, readSelectionEntry, SELECTION_ENTRY, selectionEntryData, SelectionRequest, SelectionRefused } from "@animichi/agent/selection";
import type { createCatalogClient } from "@animichi/agent/tools";
import type { AdmissionDatabase, AdmissionRecord } from "../admission/types.ts";
import { finishSelectionIntent, ownsSelection, persistSelectionIntent } from "./selection-intent.ts";
import type { SelectionOutcome, SelectionSubmission } from "./native-selection-types.ts";

export type { SelectionOutcome, SelectionSubmission } from "./native-selection-types.ts";

async function committedSelection(lane: AgentLane, requestKey: string, context: Context) {
  const entries = await lane.findEntries({ customType: SELECTION_ENTRY }, context);
  const matches = entries.flatMap((entry) => {
    const selected = readSelectionEntry(entry);
    return selected?.requestKey === requestKey ? [{ entryId: entry.id, result: selected.result }] : [];
  });
  if (matches.length > 1) throw new Error("A selection request has multiple committed results");
  return matches[0];
}

/** Must run under the same host exclusion as accept/drive, after durable scheduling. */
export async function submitSelection(db: AdmissionDatabase, lane: AgentLane, context: Context, request: SelectionSubmission, catalog: ReturnType<typeof createCatalogClient>): Promise<SelectionOutcome> {
  const previous = await db.orm.public.AgentAdmission.where({ sessionId: request.sessionId, clientMessageId: request.clientMessageId }).first();
  if (!previous && (await lane.inspectExecution(context)).current) return { kind: "blocked" };
  const intent = await persistSelectionIntent(db, request);
  if (!("admission" in intent)) return intent;
  return reconcileSelectionIntent(db, lane, context, intent.admission, catalog);
}

/** Failed native reads propagate to host reattachment; absence is never inferred from a fault. */
export async function reconcileSelectionIntent(db: AdmissionDatabase, lane: AgentLane, context: Context, admission: AdmissionRecord, catalog: ReturnType<typeof createCatalogClient>): Promise<SelectionOutcome> {
  if (admission.kind !== "selection" || admission.operationId !== null) throw new Error("Expected a non-model selection intent");
  if (!await ownsSelection(db, admission)) return { kind: "forbidden" };
  const committed = await committedSelection(lane, admission.clientMessageId, context);
  if (committed) return await finishSelectionIntent(db, admission) ? { kind: "settled", ...committed } : { kind: "forbidden" };
  if (admission.state === "void") return { kind: "rejected", reason: admission.rejectionReason ?? "Selection refused" };
  if (admission.state === "settled") throw new Error("A settled selection has no committed result");
  if ((await lane.inspectExecution(context)).current) return { kind: "pending" };
  return executePendingSelection(db, lane, context, admission, catalog);
}

async function executePendingSelection(db: AdmissionDatabase, lane: AgentLane, context: Context, admission: AdmissionRecord, catalog: ReturnType<typeof createCatalogClient>): Promise<SelectionOutcome> {
  try {
    const request = SelectionRequest.parse(admission.selectionRequest);
    const result = await executeSelection(request, await lane.findEntries(undefined, context), catalog, context);
    if ((await lane.inspectExecution(context)).current) return { kind: "pending" };
    if (!await ownsSelection(db, admission)) return { kind: "forbidden" };
    const entryId = await lane.appendCustomEntry(SELECTION_ENTRY, selectionEntryData(admission.clientMessageId, result), context);
    return await finishSelectionIntent(db, admission) ? { kind: "settled", entryId, result } : { kind: "forbidden" };
  } catch (error) {
    if (!(error instanceof SelectionRefused)) throw error;
    await finishSelectionIntent(db, admission, error.message);
    return { kind: "rejected", reason: error.message };
  }
}
