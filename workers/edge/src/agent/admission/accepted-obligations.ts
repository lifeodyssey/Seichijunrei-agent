import { lockOwnedConversation } from "./session-owner.ts";
import type { AdmissionDatabase, AdmissionRecord } from "./types.ts";

/** Business commit ④, including the independent obligation before the first drive. */
export function ensureAcceptedObligations(db: AdmissionDatabase, admission: AdmissionRecord) {
  return db.transaction(async (tx) => {
    if (!await lockOwnedConversation(db, tx, admission)) throw new Error("Conversation ownership changed");
    if (admission.operationId === null) throw new Error("A model admission requires its operation ID");
    await tx.orm.public.AgentAdmission.where({ id: admission.id }).where((row) => row.state.in(["pending", "accepted"])).update({ state: "accepted" });
    if (!await tx.orm.public.AgentOpenOperation.where({ operationId: admission.operationId }).first()) await tx.orm.public.AgentOpenOperation.create({ operationId: admission.operationId });
    if (!await tx.orm.public.AgentSettlement.where({ operationId: admission.operationId }).first()) await tx.orm.public.AgentSettlement.create({ operationId: admission.operationId });
  });
}
