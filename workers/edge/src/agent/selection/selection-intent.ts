import { SelectionRequest } from "@animichi/agent/selection";
import type { AdmissionDatabase, AdmissionRecord, AdmissionTransaction } from "../admission/types.ts";
import { lockOwnedConversation } from "../admission/session-owner.ts";
import type { SelectionSubmission } from "./native-selection-types.ts";

type Intent = { kind: "created" | "existing"; admission: AdmissionRecord } | { kind: "blocked" | "conflict" | "forbidden" };

async function digest(request: SelectionSubmission) {
  const bytes = new TextEncoder().encode(JSON.stringify([request.payer, request.selection]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function findOrCreate(tx: AdmissionTransaction, request: SelectionSubmission, requestDigest: string): Promise<Intent> {
  const existing = await tx.orm.public.AgentAdmission.where({ sessionId: request.sessionId, clientMessageId: request.clientMessageId }).first();
  if (existing) return existing.kind === "selection" && existing.requestDigest === requestDigest ? { kind: "existing", admission: existing } : { kind: "conflict" };
  const unresolved = await tx.orm.public.AgentAdmission.where({ sessionId: request.sessionId }).where((row) => row.state.in(["pending", "accepted"])).first();
  if (unresolved) return { kind: "blocked" };
  const admission = await tx.orm.public.AgentAdmission.create({ sessionId: request.sessionId, clientMessageId: request.clientMessageId,
    identityId: request.identityId, payer: request.payer, kind: "selection", requestDigest, selectionRequest: request.selection });
  return { kind: "created", admission };
}

/** The existing business ledger owns the recoverable input; no separate queue or SDK operation exists. */
export async function persistSelectionIntent(db: AdmissionDatabase, input: SelectionSubmission): Promise<Intent> {
  const request = { ...input, selection: SelectionRequest.parse(input.selection) };
  const requestDigest = await digest(request);
  return db.transaction(async (tx) => await lockOwnedConversation(db, tx, request)
    ? findOrCreate(tx, request, requestDigest) : { kind: "forbidden" });
}

export async function finishSelectionIntent(db: AdmissionDatabase, admission: AdmissionRecord, rejectionReason?: string) {
  return db.transaction(async (tx) => {
    if (!await lockOwnedConversation(db, tx, admission)) return false;
    const changed = await tx.orm.public.AgentAdmission.where({ id: admission.id }).where((row) => row.state.in(["pending", "accepted"]))
      .update({ state: rejectionReason === undefined ? "settled" : "void", rejectionReason: rejectionReason ?? null });
    return changed !== null || admission.state === "settled";
  });
}

export function ownsSelection(db: AdmissionDatabase, admission: AdmissionRecord) {
  return db.transaction((tx) => lockOwnedConversation(db, tx, admission));
}
