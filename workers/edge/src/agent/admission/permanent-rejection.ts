import { lockOwnedConversation } from "./session-owner.ts";
import type { AdmissionDatabase } from "./types.ts";
import type { ModelOperation } from "./reconcile-model-admission.ts";

export type PermanentRejectionReason = "authorization_revoked" | "quota_exhausted" | "byok_credentials_lost";

/** The business decision must commit before a documented SDK hook throws. */
export function persistPermanentRejection(db: AdmissionDatabase, operation: ModelOperation, reason: PermanentRejectionReason) {
  return db.transaction(async (tx) => {
    const row = await tx.orm.public.AgentAdmission.where(operation).first();
    if (!row || !await lockOwnedConversation(db, tx, row)) return false;
    const changed = await tx.orm.public.AgentAdmission.where(operation).where((item) => item.state.in(["pending", "accepted"]))
      .update({ rejectionReason: reason });
    return changed !== null;
  });
}
