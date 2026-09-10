/**
 * The `GET /v1/conversations/{id}/messages` boundary (SESSION-1 #959), which
 * is one page of a session read back: its transcript, its revision, the state
 * of its latest run (W1-5 #1254) and the params its runs' tools executed with
 * (E-2 #1381).
 *
 * It is its own module rather than a section of `agent-contract.ts` because it
 * is its own surface: one route, one use case on each tier
 * (`apps/agent/.../get_session_history.py` and
 * `workers/edge/src/agent/retrieval/`), and every consumer of these five
 * schemas wants exactly this route. `agent-contract.ts` keeps the shapes that
 * have no such home — health, the turn request, photo search, feedback.
 *
 * Emitted like every other boundary model: `scripts/emit-agent-python.ts`
 * reads these declarations, `test/agent-boundary.test.ts` fails on drift, and
 * `packages/contract/src/index.ts` re-exports them so the root import path is
 * unchanged.
 */

import { z } from "zod";

/** One persisted transcript row (role, content, envelope, timestamp). */
export const SessionHistoryMessage = z.object({
  role: z.string(),
  operation_id: z.string().optional(),
  content: z.string(),
  response_data: z.object({
    intent: z.string().nullish(),
    success: z.boolean().nullish(),
  }).nullable().optional(),
  created_at: z.string(),
});
export type SessionHistoryMessage = z.infer<typeof SessionHistoryMessage>;

/**
 * Why a turn ended `failed` — the `runs_failure_reason_check` vocabulary
 * verbatim (`migrations/neon/20260902000000_agent_runs.sql`). Bounded on
 * purpose: the reason reaches the browser, so it may name a lifecycle outcome
 * and never an internal detail. `workers/edge/test/agent-runs-schema.test.ts`
 * holds this list and the database's CHECK to each other.
 */
export const RunFailureReason = z.enum([
  "lease_expired",
  "deadline_exceeded",
  "provider_failed",
  "tool_failed",
  "cancelled",
  "internal_error",
]);
export type RunFailureReason = z.infer<typeof RunFailureReason>;

/**
 * The state of the session's latest run (W1-5 #1254, spec §二 "断线语义").
 *
 * History reports the native lane's current or latest immutable result. The
 * browser reconnects through the dedicated stream GET; it does not resubmit
 * model input or credentials. `reason` describes a failed native outcome.
 */
export const SessionRunStatus = z.object({
  run_id: z.string(),
  status: z.enum(["running", "succeeded", "failed"]),
  reason: RunFailureReason.nullable().optional(),
});
export type SessionRunStatus = z.infer<typeof SessionRunStatus>;

/**
 * One settled tool step of one of the session's runs (E-2 #1381).
 *
 * This is the SECOND witness `argument_correctness` scores against. What the
 * SD-9 stream publishes live is the model's own account of the call —
 * `tool-input-available.input` is `toolCall.arguments` verbatim — and an
 * evaluator that compared that with itself would be scoring the agent's
 * self-statement. `params` is what the tool actually executed with after
 * validation and coercion (the `after_tool` effective arguments), which is
 * the environment's record of the same call.
 *
 * `params` is JSON TEXT, for two reasons that agree. It is the shape the
 * original evaluator reads its raw witness in — pydantic-evals'
 * `ArgumentCorrectness` does `json.loads(span.arguments)` — and a tool's
 * arguments are arbitrary JSON, so a schema-less object here would emit a
 * `dict[str, object]` into the generated boundary models, which this repo does
 * not allow.
 */
export const SessionHistoryStep = z.object({
  run_id: z.string(),
  step_index: z.number().int().nonnegative(),
  tool_name: z.string(),
  params: z.string(),
});
export type SessionHistoryStep = z.infer<typeof SessionHistoryStep>;

/**
 * The `GET /v1/conversations/{id}/messages` payload (SESSION-1 #959).
 *
 * `run` is additive (W1-5 #1254): `null` when the session has never opened a
 * turn. It is nullable AND optional because both shapes are real. Null is what
 * either server sends for a session with no run — the Python route that serves
 * this path until #1256 flips the fallback flag emits the key too, since its
 * generated model defaults the field to `None` and the route sets no
 * `response_model_exclude_none`. Absent is every payload captured before this
 * field existed, which today's client still has to keep parsing.
 *
 * `steps` is additive on the same terms (E-2 #1381): every settled step of
 * every run of this session, each under the run that numbered it, so a caller
 * pairing a call with its settled params never has to guess which run answered
 * it. Same two absent shapes — null from the Python route, missing from every
 * payload recorded before it existed.
 */
export const GetSessionHistoryResponse = z.object({
  messages: z.array(SessionHistoryMessage),
  revision: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
  run: SessionRunStatus.nullable().optional(),
  steps: z.array(SessionHistoryStep).nullable().optional(),
});
export type GetSessionHistoryResponse = z.infer<typeof GetSessionHistoryResponse>;
