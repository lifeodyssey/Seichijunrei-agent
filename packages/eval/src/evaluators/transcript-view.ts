/**
 * The seam between the evaluators and W3-2's wire transcript.
 *
 * The types below WERE a field-for-field copy, kept local only while
 * `card/1300-w3-2-eval-task` was not on this branch's base (#1313). It is now:
 * the copy is gone and `turn-transcript.ts` — the shaper that actually builds
 * these values — is the single declaration. Two identical types would have been
 * two places for the wire's shape to be described, and the one the evaluators
 * read is the one that must not drift.
 *
 * What the wire changes versus the Python originals, and why the ports here
 * read the way they do:
 *
 * - **There is no span tree, and no need for one.** A deterministic bypass makes
 *   no model call and so produces no PydanticAI span — but it DOES publish a
 *   `tool-input-start` frame named for its stage (`turn-frames.ts`'s
 *   `serverStepOpened`, measured on staging 2026-09-07, #1454), which is why
 *   `accepted-chains.ts` lists two chains per bypass stage and why the frame
 *   carries its own `origin` (#1462). So `trajectory` is what the STREAM saw
 *   rather than a span tree rebuilt, and `stepCount` is `len(AgentResult.steps)`
 *   for every turn the wire can describe.
 * - **`status` has three states.** `"unsettled"` means the call was made and
 *   the stream never said how it ended. The three ports that default to
 *   `include_failed=False` accept only `"ok"`; `MaxToolCalls` counts all three,
 *   because an unfinished call still spent the budget.
 * - **`params` is the second witness, and it is not on the stream.** A step's
 *   `args` are the model's own account of the call and its `params` are what
 *   the runtime ran with; the first arrives on the SD-9 frames and the second
 *   on the transcript read (#1381). `ArgumentCorrectness` scores the pair, so a
 *   call the read published nothing for is `params: null` and scores 0 rather
 *   than matching itself.
 */
export type {
  AnswerPart,
  RunStatus,
  StepStatus,
  TranscriptResult,
  TranscriptStep,
} from '../turn-transcript.ts';

import type { TranscriptResult, TranscriptStep } from '../turn-transcript.ts';

/**
 * The calls that did not fail — pydantic-evals' default `include_failed=False`,
 * used by `ToolCorrectness`, `TrajectoryMatch` and `ArgumentCorrectness`.
 * `"ok"` is `StepRecord.is_success` exactly.
 */
export function completedCalls(result: TranscriptResult): readonly TranscriptStep[] {
  return result.trajectory.filter((step) => step.status === 'ok');
}

export function toolNames(steps: readonly TranscriptStep[]): string[] {
  return steps.map((step) => step.toolName);
}

/**
 * The calls the MODEL asked for — `ArgumentCorrectness`' other default, and the
 * one this side could not honour until the frames carried a step's origin
 * (#1462). Python's loop is `if item.is_success and item.model_initiated`;
 * `completedCalls` is the first half and this is the second.
 *
 * A predicate rather than a filter because one of its two readers needs each
 * step's index in the WHOLE trajectory (`gate-run/first-deviation.ts`), which a
 * filtered list would have renumbered.
 */
export function modelAsked(step: TranscriptStep): boolean {
  return step.origin === 'model';
}
