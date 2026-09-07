/**
 * `trajectory_match` — pydantic-evals' `TrajectoryMatch(order='in_order')`,
 * best over the accepted chains.
 *
 * Formula (`pydantic_evals/evaluators/agentic.py`): both sequences empty scores
 * 1.0; otherwise take the longest common subsequence of the actual and expected
 * tool sequences, then `precision = LCS / len(actual)`,
 * `recall = LCS / len(expected)` (0 when that side is empty) and
 * `F1 = 2pr / (p + r)`, itself 0 when `p + r == 0`. Extra calls cost precision,
 * missing calls cost recall. Failed and unsettled attempts are excluded.
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import { type ModelCallChain, acceptedChainsForCase, bestOverChains } from './accepted-chains.ts';
import { completedCalls, toolNames } from './transcript-view.ts';

export class OfficialTrajectoryMatch extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'OfficialTrajectoryMatch';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    const actual = toolNames(completedCalls(ctx.output));
    const chains = acceptedChainsForCase(ctx.metadata);
    return {
      trajectory_match: bestOverChains(chains, (chain) => inOrderF1(actual, chain)),
    };
  }
}

function inOrderF1(actual: readonly string[], expected: ModelCallChain): number {
  if (actual.length === 0 && expected.length === 0) {
    return 1;
  }
  const lcs = longestCommonSubsequenceLength(actual, expected);
  return f1(ratio(lcs, actual.length), ratio(lcs, expected.length));
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function f1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/** Standard rolling dynamic-programming LCS length. */
function longestCommonSubsequenceLength(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const left of a) {
    previous = nextLcsRow(previous, left, b);
  }
  return previous[b.length] ?? 0;
}

function nextLcsRow(previous: readonly number[], left: string, b: readonly string[]): number[] {
  const current = new Array<number>(b.length + 1).fill(0);
  b.forEach((right, index) => {
    const diagonal = (previous[index] ?? 0) + 1;
    const skipped = Math.max(previous[index + 1] ?? 0, current[index] ?? 0);
    current[index + 1] = left === right ? diagonal : skipped;
  });
  return current;
}
