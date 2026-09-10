import { createOrLockOwnedConversation } from "./session-owner.ts";
import type { AdmissionDatabase, AdmissionRecord, AdmissionTransaction, ModelAdmissionRequest } from "./types.ts";

export type RequestIntent = { kind: "created" | "existing"; admission: AdmissionRecord }
  | { kind: "blocked" | "conflict" | "forbidden" };

export async function requestDigest(request: ModelAdmissionRequest) {
  const bytes = new TextEncoder().encode(JSON.stringify([request.payer, request.text, request.modelIdentity, request.locale, request.origin]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function findOrCreate(tx: AdmissionTransaction, request: ModelAdmissionRequest, digest: string): Promise<RequestIntent> {
  const existing = await tx.orm.public.AgentAdmission.where({ sessionId: request.sessionId, clientMessageId: request.clientMessageId }).first();
  if (existing) return existing.requestDigest === digest && existing.kind === "model"
    ? { kind: "existing", admission: existing } : { kind: "conflict" };
  const unresolved = await tx.orm.public.AgentAdmission.where({ sessionId: request.sessionId }).where((row) => row.state.in(["pending", "accepted"])).first();
  if (unresolved) return { kind: "blocked" };
  return { kind: "created", admission: await tx.orm.public.AgentAdmission.create({
    sessionId: request.sessionId, identityId: request.identityId, payer: request.payer,
    clientMessageId: request.clientMessageId, kind: "model", operationId: crypto.randomUUID(), requestDigest: digest,
  }) };
}

/** Committed separately before quota or any SDK write; rediscoverable even after a crash. */
export async function persistRequestIntent(db: AdmissionDatabase, request: ModelAdmissionRequest): Promise<RequestIntent> {
  const digest = await requestDigest(request);
  return db.transaction(async (tx) => {
    if (!await createOrLockOwnedConversation(db, tx, request)) return { kind: "forbidden" };
    return findOrCreate(tx, request, digest);
  });
}
