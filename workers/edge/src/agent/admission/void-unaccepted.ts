import { lockOwnedConversation } from "./session-owner.ts";
import type { AdmissionDatabase, AdmissionRecord, AdmissionTransaction } from "./types.ts";

async function refundReservation(db: AdmissionDatabase, tx: AdmissionTransaction, row: AdmissionRecord) {
  if (row.quotaReservedAt === null || row.quotaRefundedAt !== null) return false;
  if (row.quotaUsageDate === null) throw new Error("A reservation requires its original usage date");
  const plan = db.raw.sql`UPDATE anon_daily_message_count SET message_count = message_count - 1
    WHERE usage_date = ${row.quotaUsageDate}::date AND anon_id = ${row.identityId} AND message_count > 0
    RETURNING message_count::integer AS count`.returnsRow({ count: "pg/int4@1" }).build();
  if ((await tx.query(plan)).length !== 1) throw new Error("The pending admission reservation cannot be refunded");
  return true;
}

/** Only the successful, current SDK absence witnesses may enter this transaction. */
export function voidUnacceptedAdmission(db: AdmissionDatabase, admission: AdmissionRecord, now: number) {
  return db.transaction(async (tx) => {
    if (!await lockOwnedConversation(db, tx, admission)) throw new Error("Conversation ownership changed");
    const row = await tx.orm.public.AgentAdmission.where({ id: admission.id }).first();
    if (row?.state !== "pending") return false;
    const refunded = await refundReservation(db, tx, row);
    await tx.orm.public.AgentAdmission.where({ id: row.id }).update({ state: "void",
      ...(refunded ? { quotaRefundedAt: new Date(now).toISOString() } : {}) });
    return true;
  });
}
