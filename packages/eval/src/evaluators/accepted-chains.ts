/**
 * ANY-of-N: the set of model-call chains a case's trajectory may match.
 *
 * A case does not name one expected tool sequence — it names acceptable
 * *stages*, and each stage contributes one or more chains. The official
 * evaluators run once per chain and keep the best score, which is how the
 * dataset's disjunction survives evaluators that take a single expectation.
 *
 * Ported verbatim from `_GENERAL_QA_CHAINS`, `_STAGE_MODEL_CALL_CHAINS`,
 * `_STAGE_MIN_STEPS`, `accepted_chains_for_case`, `_model_call_chains_for_stages`
 * and `_acceptable_min_steps` in
 * `apps/agent/src/animichi/tests/eval/evaluators.py`.
 */

import type { ExportedAgentExpected, ExportedAgentInput } from '../dataset-roundtrip.ts';
import { type TranscriptResult, toolNames } from './transcript-view.ts';

/** One accepted sequence of locally-executed, model-initiated tool calls. */
export type ModelCallChain = readonly string[];

const GENERAL_QA_CHAINS: readonly ModelCallChain[] = [
  [],
  ['web_search'],
  ['translate_anime_title'],
  ['web_search', 'translate_anime_title'],
  ['translate_anime_title', 'web_search'],
];

/**
 * A DETERMINISTIC BYPASS IS TWO CHAINS, because this table answers to two
 * trajectory sources (#1454).
 *
 * In process, a bypass makes no model call and therefore no span, so the empty
 * chain is what a Python run observes. Over the wire — this runner's only
 * source (`turn-transcript.ts`, rewrite spec §一) — the same turn publishes ONE
 * tool part named for the stage: the runtime streams its server-initiated step
 * exactly as it streams a model-initiated one (`turn-frames.ts`'s
 * `serverStepOpened`, Python's `selection.py::_emit`), and the frames carry no
 * member that tells the two apart. Measured on staging 2026-09-07: all four
 * seeded `plan_multi` cases of `phase1c_selection_v1` published `plan_multi`
 * and nothing else, so the empty chain scored the two turns that FAILED 1.0 and
 * the two that did the work 0.0. `plan_selected` is the same shape on the other
 * bypass (#1461): `K1_ja_001` and `K1_en_002` each published `plan_selected`
 * and nothing else, and each scored `trajectory_match`, `tool_correctness` and
 * `max_tool_calls` 0.0 under the empty chain alone. Both chains are listed so
 * each runner's honest observation is accepted and neither is fitted to the
 * other.
 */
const STAGE_MODEL_CALL_CHAINS = new Map<string, readonly ModelCallChain[]>([
  ['search_bangumi', [['resolve_anime', 'search_bangumi']]],
  ['search_nearby', [['search_nearby']]],
  ['plan_route', [['resolve_anime', 'search_bangumi', 'plan_route']]],
  ['plan_selected', [[], ['plan_selected']]],
  ['plan_multi', [[], ['plan_multi']]],
  ['clarify', [['resolve_anime'], []]],
  ['clarify_after_nearby', [['search_nearby']]],
  ['greet_user', [[]]],
  ['general_qa', GENERAL_QA_CHAINS],
]);

/** Ideal visible-step counts, carried over verbatim from `_STAGE_MIN_STEPS`. */
const STAGE_MIN_STEPS = new Map<string, number>([
  ['search_bangumi', 2],
  ['search_nearby', 1],
  ['plan_route', 3],
  ['plan_selected', 1],
  ['plan_multi', 1],
  ['clarify', 1],
  ['clarify_after_nearby', 2],
  ['greet_user', 0],
  ['general_qa', 0],
]);

/** An unknown stage accepts the empty chain and costs two ideal steps. */
const UNKNOWN_STAGE_CHAINS: readonly ModelCallChain[] = [[]];
const UNKNOWN_STAGE_MIN_STEPS = 2;

/**
 * The chains that would accept this case. The stage decides, and only the
 * stage.
 *
 * This used to short-circuit to the empty chain whenever the inputs carried a
 * selection, on the theory that every selection turn bypasses the model.
 * `plan_selected` and `plan_multi` do, and their own entries in
 * `STAGE_MODEL_CALL_CHAINS` already say so. Counted over the six exported sets,
 * TWENTY cases carry a selection — fifteen `plan_selected` in `agent_eval_v3`,
 * four `plan_multi` and one `search_nearby` in `phase1c_selection_v1`. Count it
 * on `!== null`, not on truthiness: three of the fifteen (`K3_ja_001`,
 * `K3_zh_001`, `K3_en_001`) select an EMPTY list, and the short-circuit fired
 * on them too. So it changed the answer for none of the nineteen bypass cases.
 * The twentieth is a *place* selection, which does not bypass the model: it
 * re-runs `search_nearby` against the chosen place, and its stage says so, but
 * the short-circuit overrode the stage and accepted the empty chain — so
 * `D3_place_selection_radius` scored 1.0 for calling nothing and 0.0 for making
 * the call it was asked for (#1439).
 */
export function acceptedChainsForCase(
  metadata: ExportedAgentExpected | undefined,
): readonly ModelCallChain[] {
  return chainsForStages(metadata?.acceptable_stages ?? []);
}

/** Ordered dedup across the stages' chains — Python's `dict.fromkeys`. */
function chainsForStages(stages: readonly string[]): readonly ModelCallChain[] {
  const unique = new Map<string, ModelCallChain>();
  for (const stage of stages) {
    for (const chain of STAGE_MODEL_CALL_CHAINS.get(stage) ?? UNKNOWN_STAGE_CHAINS) {
      unique.set(JSON.stringify(chain), chain);
    }
  }
  return [...unique.values()];
}

/**
 * Run `score` once per accepted chain and keep the best. A case with no
 * accepted chain scores 1.0 — `_best(..., empty=1.0)`: there was nothing to
 * violate.
 */
export function bestOverChains(
  chains: readonly ModelCallChain[],
  score: (chain: ModelCallChain) => number,
): number {
  return chains.length === 0 ? 1 : Math.max(...chains.map(score));
}

/**
 * The ideal step counts this case may be measured against. The three special
 * branches are checked in Python's order — a seeded place ambiguity wins over
 * the `clarify_after_nearby` geocode branch even when both apply.
 */
export function acceptableMinSteps(
  inputs: ExportedAgentInput,
  metadata: ExportedAgentExpected | undefined,
  result: TranscriptResult,
): readonly number[] {
  const stages = metadata?.acceptable_stages ?? [];
  if (stages.includes('plan_multi') && inputs.selected_candidate_ids !== null) {
    return [new Set(inputs.selected_candidate_ids).size + 1];
  }
  if (seededReason(inputs) === 'place_ambiguity') {
    return [1];
  }
  if (stages.includes('clarify_after_nearby') && geocoded(result)) {
    return [3];
  }
  return stageMinSteps(stages);
}

function stageMinSteps(stages: readonly string[]): readonly number[] {
  const minima = stages.map((stage) => STAGE_MIN_STEPS.get(stage) ?? UNKNOWN_STAGE_MIN_STEPS);
  return minima.length === 0 ? [1] : minima;
}

function seededReason(inputs: ExportedAgentInput): unknown {
  return inputs.seeded_pending?.reason ?? null;
}

/** `_actual_tools` is every step, not only the model-initiated ones. */
function geocoded(result: TranscriptResult): boolean {
  return toolNames(result.trajectory).includes('geocode');
}
