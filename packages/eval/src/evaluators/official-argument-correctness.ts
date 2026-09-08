/**
 * `argument_correctness` — pydantic-evals'
 * `ArgumentCorrectness(match_mode='exact')`, run once per successful call and
 * reduced with `min`.
 *
 * Formula (`pydantic_evals/evaluators/agentic.py`): find the calls to the named
 * tool, pick the requested 0-based occurrence, and compare its recorded
 * arguments with the expected ones — `'exact'` fails on a missing key, an
 * unequal value, or an unexpected key, i.e. deep equality. A tool that was
 * never called, an occurrence out of range, and unrecorded arguments all score
 * 0.0 rather than passing vacuously. A turn with no successful call returns
 * `{}` — no metric, not a zero.
 *
 * WHAT IS COMPARED WITH WHAT. `OfficialArgumentCorrectness` (Python) passes
 * `StepRecord.params` as the EXPECTED arguments and lets the official evaluator
 * read the ACTUAL ones off the tool's span. Two records of one call, by two
 * authors: the model said what it wanted, and the runtime settled what it got.
 * The wire publishes the same pair since #1381 — `args` off the SD-9 stream,
 * `params` off `GET /v1/conversations/{id}/messages` — and `turn-transcript.ts`
 * pairs them by tool name and occurrence, exactly as `occurrence=k` does.
 *
 * The comparison is deep equality and nothing else, because that is all
 * `'exact'` is: `_diff_arguments` reports every expected key that is missing or
 * unequal, then every actual key that was not expected. Python parses its
 * actual side out of the span's JSON text first (`json.loads`), which is why
 * the wire carries `params` as text and the shaper parses it the same way.
 *
 * THREE ANSWERS, NOT TWO. A read that published no `steps` array at all — a
 * page from an edge older than #1381, the Python route's `null`, a read that
 * never answered — offered no second record for ANY call, so the metric is not
 * computable and emits nothing, the same `{}` a turn with no successful call
 * emits. Scoring those turns 0 would report a whole run of mismatches that
 * nobody measured.
 *
 * Within a read that DID publish steps, a call with no step of its own scores
 * 0. Python would have compared an empty `params` dict there and passed the
 * call vacuously when it happened to have been made with no arguments — the
 * `params_recorded` ambiguity #443 names. That is the one deliberate
 * refinement here: a call nobody witnessed must not be able to score 1.0, and
 * no oracle case reaches the branch, so the two runners still agree on every
 * measured turn.
 *
 * ONLY THE MODEL'S OWN CALLS ARE SCORED (#1462). Python's loop is
 * `if item.is_success and item.model_initiated` (`official_evaluators.py:77-81`),
 * and the second half was unreachable here until the frames said which steps the
 * runtime opened for itself. A deterministic bypass — `plan_selected`,
 * `plan_multi`, a place pick's radius `search_nearby` — is opened with `{}`
 * because no model produced arguments for it, while its settled step carries the
 * request the visitor made; the two witnesses therefore disagreed by
 * construction and the metric read 0.0 on every successful bypass turn. That is
 * a fact about the runtime, not about the agent, so it is not scored — exactly
 * as Python does not score it, and as Python's own committed baseline shows
 * (its fifteen `K1`/`K3` cases carry no `argument_correctness` key at all).
 */

import { isDeepStrictEqual } from 'node:util';

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import { type TranscriptStep, completedCalls, modelAsked } from './transcript-view.ts';

export class OfficialArgumentCorrectness extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'OfficialArgumentCorrectness';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    if (!ctx.output.paramsRecorded) return {};
    const scores = completedCalls(ctx.output).filter(modelAsked).map(settledArgumentsMatch);
    return scores.length === 0 ? {} : { argument_correctness: Math.min(...scores) };
  }
}

/** Whether the call ran with the arguments it was made with. */
function settledArgumentsMatch(step: TranscriptStep): number {
  if (step.params === null) return 0;
  return isDeepStrictEqual(step.args, step.params) ? 1 : 0;
}
