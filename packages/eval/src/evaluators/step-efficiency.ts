/**
 * `step_efficiency` — L2: ideal steps over actual steps, capped at 1.0, so the
 * metric only ever measures wasted steps.
 *
 * The case may accept several ideal counts (one per acceptable stage, plus
 * three special branches); the best of them wins. Ported from `StepEfficiency`
 * in `apps/agent/src/animichi/tests/eval/evaluators.py`, where the denominator
 * is `len(ctx.output.steps)`; on the wire that is `stepCount`.
 *
 * **A turn with no steps has no denominator**, and which answer that deserves
 * depends on what the case asked for. When one of the acceptable ideals is zero
 * — `greet_user`, `general_qa` — taking no step IS the ideal, so the turn keeps
 * 1.0. When every acceptable ideal is at least one, the turn did not attempt
 * the task, and this metric has nothing to say about it: it measures waste, not
 * correctness, and the turn's actual failure is reported by `trajectory_match`
 * and `data_keys_present`, which own it. So it emits NO metric — the same `{}`
 * `NonemptyResults` and `OfficialArgumentCorrectness` emit for a case they
 * cannot measure. Returning 1.0 there put a refusal on the ceiling: all five
 * `phase1c_selection_v1` cases scored a perfect `step_efficiency` for making no
 * call at all (#1439).
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import { acceptableMinSteps } from './accepted-chains.ts';

export class StepEfficiency extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'StepEfficiency';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    const minima = acceptableMinSteps(ctx.inputs, ctx.metadata, ctx.output);
    const actual = ctx.output.stepCount;
    if (actual === 0) {
      return Math.min(...minima) > 0 ? {} : { step_efficiency: 1 };
    }
    return { step_efficiency: Math.max(...minima.map((ideal) => Math.min(ideal / actual, 1))) };
  }
}
