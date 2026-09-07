/**
 * The base every agent-turn evaluator shares: the generic triple, the metric
 * shape, and the version string baselines are compared across.
 *
 * `EVALUATOR_VERSION` mirrors `evaluators.py`'s `EVALUATOR_VERSION`. Python
 * stamps it on the results payload (`exec_tiers.build_results_payload`); the TS
 * side stamps it on each evaluator instance, where `logfire/evals` propagates
 * it to `gen_ai.evaluation.evaluator.version`. Bump both together or the two
 * runners' numbers stop being comparable.
 */

import { Evaluator } from 'logfire/evals';
import type { EvaluatorContext } from 'logfire/evals';

import type { ExportedAgentExpected, ExportedAgentInput } from '../dataset-roundtrip.ts';
import type { TranscriptResult } from './transcript-view.ts';

export const EVALUATOR_VERSION = 'official-v2';

/**
 * One evaluator's contribution to a case's scores. Empty means "this metric
 * does not apply to this case" — Python's `{}` return, which pydantic-evals
 * and `logfire/evals` both read as "emit nothing", not as a zero.
 */
export type MetricRecord = Record<string, number>;

export type AgentTurnContext = EvaluatorContext<
  ExportedAgentInput,
  TranscriptResult,
  ExportedAgentExpected
>;

export abstract class AgentTurnEvaluator extends Evaluator<
  ExportedAgentInput,
  TranscriptResult,
  ExportedAgentExpected
> {
  override evaluatorVersion = EVALUATOR_VERSION;

  abstract override evaluate(ctx: AgentTurnContext): MetricRecord;
}
