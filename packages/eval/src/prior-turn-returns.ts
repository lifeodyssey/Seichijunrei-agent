/**
 * The structured tool returns of the SESSION'S EARLIER TURNS, which the model
 * reads back on the measured turn (E-3 #1382, spec §九 9.1 / §十 10.3).
 *
 * WHY THIS EXISTS AT ALL. #1377 made the edge replay every run of a session as
 * `assistant` + `toolResult` messages rather than degrading an earlier turn's
 * tool-call row to its plain text
 * (`workers/edge/src/agent/session/turn-transcript.ts`). So on the measured turn
 * the model has the earlier turns' returns in front of it, and a title it took
 * from one of them is a SOURCED statement. A verifier that enumerated only this
 * run's returns would mark those statements untraceable — the spec calls that
 * out by name: 「只认『本次 run』会与 §九 直接冲突」.
 *
 * WHERE THEY COME FROM ON THIS SIDE. Not from the transcript read: `steps`
 * carries `run_id`, `step_index`, `tool_name` and `params` and no return at all
 * (`packages/contract/src/session-history-contract.ts`). The returns are on the
 * SSE streams, and an eval case's earlier turns are streams this runner itself
 * drove — `caseSubmissionsOf` turns `context.message_history` into N+1 posts on
 * one session, and until now `StagingTurnTask` kept only the last response. So
 * "the earlier runs' returns" is exactly "the earlier submissions' frames",
 * read the same way the measured turn's are. The reading happens HERE and the
 * shaper is handed the result, rather than the other way round: `turn-transcript.ts`
 * owns the frame grammar, and importing it back into itself would be a cycle.
 *
 * WHAT IS NOT HERE, and is covered elsewhere: a case's E-1 frozen prefix
 * (#1380) is posted by `CaseLifecycle.setup()` through the seeding procedure
 * rather than by a `/v1/chat` turn, so no stream of it exists to read. The
 * pending clarification it left is witnessed by `inputs.seeded_pending`
 * instead, which is what the `<agent_status>` bar renders from it
 * (`agent-status.ts::openQuestionLine`).
 */
import { trajectoryOf, type TranscriptStep, type TurnFrame } from "./turn-transcript.ts";

/**
 * Every earlier turn's calls, oldest turn first.
 *
 * Flattened rather than kept per turn because the one consumer asks a
 * set-membership question — was this name ever returned to the model — and a
 * per-turn shape would only invite an ordering claim nothing on this side can
 * check. Each step's `params` stays `null`: the settled-params pairing is the
 * MEASURED run's (`settled-params.ts`), and an earlier turn's call has no
 * second witness read for it.
 */
export function priorTurnReturns(
  priorFrames: readonly (readonly TurnFrame[])[],
): readonly TranscriptStep[] {
  return priorFrames.flatMap((frames) => [...trajectoryOf(frames)]);
}
