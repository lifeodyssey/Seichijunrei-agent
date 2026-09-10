import type { AdmissionDatabase, ModelAdmissionOutcome, ModelAdmissionRequest } from "../admission/types.ts";
import { requestDigest } from "../admission/request-intent.ts";

/** Reading an existing admitted operation never acquires a business write lock or changes quota. */
export async function watchableReplay(db: AdmissionDatabase, request: ModelAdmissionRequest): Promise<ModelAdmissionOutcome | undefined> {
  const rows = await db.runtime().query(db.raw.sql`SELECT user_id AS owner FROM sessions WHERE id = ${request.sessionId}`
    .returnsRow({ owner: { codecId: "pg/text@1", nullable: true } }).build());
  if (rows[0]?.owner !== request.identityId) return { kind: "forbidden", operationId: null };
  const admission = await db.orm.public.AgentAdmission.where({ sessionId: request.sessionId, clientMessageId: request.clientMessageId }).first();
  if (!admission) return undefined;
  if (admission.kind !== "model" || admission.requestDigest !== await requestDigest(request)) return { kind: "conflict", operationId: null };
  if (!admission.operationId || !["accepted", "settled"].includes(admission.state)) return undefined;
  return { kind: "replayed", operationId: admission.operationId };
}
