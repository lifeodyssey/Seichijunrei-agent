import { anonymousBudgetAvailable } from "../host/native-authority.ts";
import { quotaReservationFor } from "../intake/quota-reservation.ts";
import { lockOwnedConversation } from "./session-owner.ts";
import type { AdmissionDatabase, AdmissionOptions, AdmissionRecord, AdmissionTransaction } from "./types.ts";

async function reserveCounter(db: AdmissionDatabase, tx: AdmissionTransaction, identityId: string, day: string, allowance: number) {
  const plan = db.raw.sql`INSERT INTO anon_daily_message_count (usage_date, anon_id, message_count)
    VALUES (${day}::date, ${identityId}, 1) ON CONFLICT (usage_date, anon_id) DO UPDATE
    SET message_count = anon_daily_message_count.message_count + 1
    WHERE ${allowance} = 0 OR anon_daily_message_count.message_count < ${allowance}
    RETURNING message_count::integer AS count`.returnsRow({ count: "pg/int4@1" }).build();
  return (await tx.query(plan)).length === 1;
}

async function reserve(tx: AdmissionTransaction, db: AdmissionDatabase, row: AdmissionRecord, options: AdmissionOptions) {
  if (row.payer !== "anon" && row.payer !== "user" && row.payer !== "byok") throw new Error("Invalid admission payer");
  const quota = quotaReservationFor(row.payer, row.identityId, options.now);
  if (quota === null || row.quotaReservedAt !== null) return true;
  if (options.anonymousDailyBudget !== undefined && !(await anonymousBudgetAvailable(db, tx, options.anonymousDailyBudget, options.now))[0]?.available) {
    await tx.orm.public.AgentAdmission.where({ id: row.id }).update({ state: "void", rejectionReason: "anonymous_budget_exhausted" });
    return false;
  }
  const accepted = await reserveCounter(db, tx, row.identityId, quota.usageDate, options.anonymousAllowance);
  await tx.orm.public.AgentAdmission.where({ id: row.id }).update(accepted
    ? { quotaUsageDate: quota.usageDate, quotaReservedAt: new Date(options.now).toISOString() }
    : { state: "void", rejectionReason: "anonymous_quota_exhausted" });
  return accepted;
}

export function reserveAdmissionQuota(db: AdmissionDatabase, admission: AdmissionRecord, options: AdmissionOptions) {
  return db.transaction(async (tx) => {
    if (!await lockOwnedConversation(db, tx, admission)) throw new Error("Conversation ownership changed");
    const row = await tx.orm.public.AgentAdmission.where({ id: admission.id }).first();
    if (row?.state !== "pending") return false;
    return reserve(tx, db, row, options);
  });
}
