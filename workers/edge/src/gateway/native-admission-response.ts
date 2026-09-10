import type { ModelAdmissionOutcome } from "../agent/admission/types.ts";
import { quotaResetsAt } from "../agent/intake/anonymous-message-allowance.ts";
import { budgetGuidanceResponse } from "../protect/cost-breaker.ts";
import { conversationNotFound, quotaExhausted, turnInFlight } from "./agent-turn-responses.ts";

/** Public response semantics are projected from native admission outcomes, independently of execution. */
export function modelAdmissionResponse(outcome: ModelAdmissionOutcome, sessionId: string, now = Date.now()) {
  if (outcome.kind === "accepted" || outcome.kind === "replayed" || outcome.kind === "pending")
    return Response.json({ session_id: sessionId, run_id: outcome.operationId, operation_id: outcome.operationId, streaming: false }, { status: 202, headers: { "cache-control": "no-store" } });
  if (outcome.kind === "forbidden") return conversationNotFound();
  if (outcome.kind !== "rejected") return turnInFlight();
  if (outcome.reason === "anonymous_budget_exhausted") return budgetGuidanceResponse();
  if (outcome.reason === "anonymous_quota_exhausted") return quotaExhausted(quotaResetsAt(new Date(now).toISOString().slice(0, 10)));
  return Response.json({ error: { code: "operation_refused", reason: outcome.reason } }, { status: 403 });
}
