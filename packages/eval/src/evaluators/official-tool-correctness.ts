/**
 * `tool_correctness` — pydantic-evals' `ToolCorrectness`, best over the
 * accepted chains.
 *
 * Formula (`pydantic_evals/evaluators/agentic.py`): compare the multiset of
 * called tool names against the expected multiset. With `allow_extra=False`
 * (the default) any missing *or* any unexpected call fails, so the score is
 * 1.0 only on an exact multiset match. Failed and unsettled attempts are
 * excluded (`include_failed=False`).
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import { type ModelCallChain, acceptedChainsForCase, bestOverChains } from './accepted-chains.ts';
import { completedCalls, toolNames } from './transcript-view.ts';

export class OfficialToolCorrectness extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'OfficialToolCorrectness';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    const actual = toolNames(completedCalls(ctx.output));
    const chains = acceptedChainsForCase(ctx.metadata);
    return {
      tool_correctness: bestOverChains(chains, (chain) => multisetMatch(actual, chain)),
    };
  }
}

function multisetMatch(actual: readonly string[], expected: ModelCallChain): number {
  const actualCounts = countByName(actual);
  const expectedCounts = countByName(expected);
  const names = new Set([...actualCounts.keys(), ...expectedCounts.keys()]);
  return [...names].every((name) => actualCounts.get(name) === expectedCounts.get(name)) ? 1 : 0;
}

function countByName(names: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}
