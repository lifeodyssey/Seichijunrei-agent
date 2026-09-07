/**
 * `max_tool_calls` — pydantic-evals' `MaxToolCalls`, budgeted by the longest
 * accepted chain.
 *
 * Formula (`pydantic_evals/evaluators/agentic.py`): count the locally-executed
 * tool calls and score 1.0 while `count <= max_calls`. Unlike the other three,
 * this one defaults to `include_failed=True`, so the whole trajectory counts:
 * a failed or unsettled attempt still spent time and tokens. A case with no accepted chain
 * gets a budget of 0 (`default=0`), which any call at all overruns.
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import { acceptedChainsForCase } from './accepted-chains.ts';

export class OfficialMaxToolCalls extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'OfficialMaxToolCalls';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    const chains = acceptedChainsForCase(ctx.metadata);
    const budget = Math.max(0, ...chains.map((chain) => chain.length));
    return { max_tool_calls: ctx.output.trajectory.length <= budget ? 1 : 0 };
  }
}
