import type { AgentLane } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Session } from "@earendil-works/pi-agent-core/harness/session";
import { persistPermanentRejection } from "../admission/permanent-rejection.ts";
import { prepareModelOperation } from "../recovery/prepare-model-operation.ts";
import { operationAuthority } from "./native-authority.ts";
import type { NativeSessionResources } from "./native-bootstrap.ts";

async function cancelKnownRefusal(resources: NativeSessionResources, lane: AgentLane, sessionId: string, operationId: string, reason: "byok_credentials_lost" | "quota_exhausted", context: Context) {
  if (!await persistPermanentRejection(resources.db, { sessionId, operationId }, reason)) return false;
  const aborted = await lane.requestAbort(operationId, context);
  if (!aborted.ok) throw aborted.error;
  return true;
}
function rejection(payer: string, hasCredential: boolean, authority: string) {
  if (payer === "byok" && !hasCredential) return "byok_credentials_lost";
  return authority === "quota_exhausted" ? "quota_exhausted" : null;
}

/** Current witnesses and origin precede credential/authority decisions; cancellation never spends a key. */
export async function prepareAuthorizedDrive(resources: NativeSessionResources, hasCredential: boolean, session: Session, lane: AgentLane, operationId: string, context: Context) {
  const { db, budget } = resources;
  if (!await prepareModelOperation(db, session, lane, operationId, context)) return false;
  const operation = { sessionId: session.metadata.id, operationId };
  const row = await db.orm.public.AgentAdmission.where(operation).first();
  if (!row) return false;
  const authority = await operationAuthority(db, operation.sessionId, operationId, budget, context);
  if (authority === "unavailable") return false;
  const reason = rejection(row.payer, hasCredential, authority);
  if (reason) return cancelKnownRefusal(resources, lane, operation.sessionId, operationId, reason, context);
  return authority === "rejected" || row.payer === "byok" || resources.server.available;
}
