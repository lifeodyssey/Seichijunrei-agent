/** Pure anonymous-quota eligibility and the original UTC reservation day. */
import type { ModelAdmissionRequest } from "../admission/types.ts";

/** The exact counter row one turn reserves a message in. */
export interface QuotaReservation {
  readonly identityId: string;
  /** `anon_daily_message_count.usage_date`, an ISO `YYYY-MM-DD` UTC day. */
  readonly usageDate: string;
}

/** The edge's anonymous identity shape (`src/identity/anonymous-id.ts`). */
const METERED_IDENTITY = /^anon_[0-9a-f]{32}$/;

/** The UTC calendar day `anon_daily_message_count` and `daily_usage` share. */
export function utcUsageDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * The reservation a submission takes, or `null` when nothing is metered: a
 * signed-in visitor is counted by no daily-message quota, and a BYOK turn
 * spends the visitor's own key.
 */
export function quotaReservationFor(
  payer: ModelAdmissionRequest["payer"],
  identityId: string,
  nowMs: number,
): QuotaReservation | null {
  if (payer !== "anon" || !METERED_IDENTITY.test(identityId)) return null;
  return { identityId, usageDate: utcUsageDate(nowMs) };
}
