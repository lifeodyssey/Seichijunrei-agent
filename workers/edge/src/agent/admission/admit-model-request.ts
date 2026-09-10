import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { persistRequestIntent } from "./request-intent.ts";
import { reserveAdmissionQuota } from "./reserve-quota.ts";
import { ensureAcceptedObligations } from "./accepted-obligations.ts";
import type { AdmissionDatabase, AdmissionOptions, AdmissionRecord, ModelAdmissionOutcome, ModelAdmissionRequest } from "./types.ts";

function replay(admission: AdmissionRecord): ModelAdmissionOutcome {
  if (admission.operationId === null) return { kind: "conflict", operationId: null };
  if (admission.state === "void") return { kind: "rejected", operationId: admission.operationId, reason: admission.rejectionReason ?? "unaccepted" };
  return { kind: admission.state === "pending" ? "pending" : "replayed", operationId: admission.operationId };
}

export async function acceptReservedModel(db: AdmissionDatabase, lane: AgentLane, context: Context, request: ModelAdmissionRequest, admission: AdmissionRecord): Promise<ModelAdmissionOutcome> {
  if (admission.operationId === null) throw new Error("A model admission requires its operation ID");
  const result = await lane.accept({ kind: "prompt", prompt: request.text, operationId: admission.operationId }, context);
  if (!result.ok) return { kind: "pending", operationId: admission.operationId };
  await ensureAcceptedObligations(db, admission);
  return { kind: "accepted", operationId: admission.operationId };
}

/** Persist intent and reserve quota before the caller configures the actual native lane. */
export async function prepareModelAdmission(db: AdmissionDatabase, request: ModelAdmissionRequest, options: AdmissionOptions): Promise<ModelAdmissionOutcome | AdmissionRecord> {
  if (!Number.isSafeInteger(options.anonymousAllowance) || options.anonymousAllowance < 0) throw new Error("Invalid anonymous allowance");
  const intent = await persistRequestIntent(db, request);
  if (!("admission" in intent)) return { kind: intent.kind, operationId: null };
  if (intent.kind === "existing") return replay(intent.admission);
  if (!await reserveAdmissionQuota(db, intent.admission, options)) {
    const refused = await db.orm.public.AgentAdmission.where({ id: intent.admission.id }).first();
    return { kind: "rejected", operationId: intent.admission.operationId ?? "", reason: refused?.rejectionReason ?? "anonymous_quota_exhausted" };
  }
  return intent.admission;
}

/** Called under the host mutex after durable recovery scheduling and successful attachment. */
export async function admitModelRequest(db: AdmissionDatabase, lane: AgentLane, context: Context, request: ModelAdmissionRequest, options: AdmissionOptions): Promise<ModelAdmissionOutcome> {
  const prepared = await prepareModelAdmission(db, request, options);
  return "id" in prepared ? acceptReservedModel(db, lane, context, request, prepared) : prepared;
}
