/**
 * Where a failed turn FIRST left the rails (E-4 #1383, spec §十 10.4).
 *
 * 李博杰《深入理解 AI Agent》ch.7 「失败归因：从整条轨迹定位首个错误」: an end-to-end
 * score says pass or fail and nothing about which step broke it, and 「归因对象是轨迹
 * 中的首个导致任务偏离的错误，后续错误往往只是连锁反应」. So this module locates ONE
 * deviation per failed case and files every later one under consequences.
 *
 * RULES ONLY, NO MODEL. The spec's own words: 「规则先筛、不引入 LLM」. Three signals,
 * each already computable from what a run records:
 *
 * 1. the first positional divergence from the case's accepted chains
 *    (`chain-divergence.ts`, off `evaluators/accepted-chains.ts`);
 * 2. every step the wire settled as `status === "error"` (`turn-transcript.ts`'s
 *    three-state status);
 * 3. every claim the final-reply verifier could not trace (E-3 #1382, re-read
 *    claim by claim in `unsourced-claims.ts`).
 *
 * A FOURTH SIGNAL THE SPEC DOES NOT LIST, added because leaving it out left a
 * positioned failure with no column. `argument_correctness` is live
 * (`metric-names.ts`) and what it scores is precisely "right tool, wrong
 * arguments" — `OfficialArgumentCorrectness` already knows WHICH completed call
 * disagreed, and the oracle's `settled_params_dropped_an_optional_null` is a
 * turn where every other metric is 1 and that one is 0. Under three signals that
 * case came back unattributed, which is the answer reserved for a failure with
 * no place in the trajectory; this one has a place. So signal 2 is really "how
 * a call the wire witnessed turned out", and it has two answers: the call
 * errored, or it ran with arguments the model did not ask for.
 *
 * `"unsettled"` IS NOT SIGNAL 2. The three states exist because the wire
 * distinguishes three, and `turn-transcript.ts` says why collapsing them lies:
 * a call the stream never settled 「would report a tool failure that never
 * happened」. The spec names `status === "error"` and only that; an unsettled
 * call is the harness's own observation gap — the AndroidWorld footnote in §十
 * 10.4 — and inventing a fourth signal for it would attribute a harness fault to
 * the model.
 *
 * THE EARLIEST RULE, WRITTEN DOWN because the three signals are not on one
 * scale. Signals 1 and 2 point at a STEP; signal 3 points at a sentence the
 * model wrote AFTER every step of the turn. So a deviation is ordered by the
 * triple
 *
 *     (step_index ?? trajectory.length, TIE_ORDER[category], claim_index ?? 0)
 *
 * and the earliest is the smallest. Three consequences of that, each deliberate:
 *
 * - **A reply claim is later than every step**, because it is: `trajectory.length`
 *   is past the last index. A turn that both called the wrong tool and then
 *   mis-reported is attributed to the call.
 * - **A missing call sits at `trajectory.length` too** — the position the call
 *   the chain wanted would have occupied — and beats a reply claim on the tie
 *   break. If the chain required a call nobody made, that absence is the cause
 *   and the reply with nothing to cite is its consequence.
 * - **At one step, a chain divergence beats wrong arguments, which beat a tool
 *   error.** Choosing the wrong tool outranks calling the right one wrongly, and
 *   calling it wrongly outranks it erroring. (The last two can never actually
 *   collide — one is only asked of an `ok` step and the other only of an
 *   `error` step — but the order is stated rather than left to the sort.)
 */
import { isDeepStrictEqual } from 'node:util';

import type { ExportedAgentExpected, ExportedAgentInput } from '../dataset-roundtrip.ts';
import type { TranscriptResult, TranscriptStep } from '../turn-transcript.ts';
import { chainDivergenceOf } from './chain-divergence.ts';
import { decidedClaimsOf, type DecidedClaim } from './unsourced-claims.ts';

/**
 * The closed category vocabulary: 李博杰 ch.7's Coding Agent failure table, cut
 * down to what THIS repo's tool surface can witness without a judge. One member
 * per thing the three rules can actually tell apart — a category no rule can
 * produce would be a column nobody could ever fill.
 *
 * | Member | The book's row | Why it is in this repo's cut |
 * |---|---|---|
 * | `wrong_tool` | 工具选择错误 | A call sits where an accepted chain wanted a different tool. The six model tools are distinct surfaces; picking `search_nearby` where `resolve_anime` belongs is the repo's commonest first error. |
 * | `missing_call` | 该调用的工具没有调用 | The chain outlived the trajectory. This is the 「宣告完成」 shape: the turn answered without doing the work. |
 * | `extra_call` | 冗余/重复调用 | A call past the end of every accepted chain. §九 9.1 names this failure mode by hand — a sliding-window transcript makes the model 「重复执行已完成的操作」 — so it has to be nameable here. |
 * | `wrong_arguments` | 工具参数错误 | The right tool, called with arguments the runtime had to change: `args` off the stream and `params` off the transcript read disagree, which is `argument_correctness` scoring 0 (`official-argument-correctness.ts`). A live metric whose failure has a step index, so it needs a category rather than an `unattributed`. |
 * | `tool_error` | 工具调用失败 | The environment refused the call (`tool-output-error`). Separate from `wrong_tool` because the fix is different: the right tool that errored is a tool or data problem, not a planning one. |
 * | `reply_unsourced` | 对用户的信息反馈错误 | §十 10.3's whole reason for existing: the environment state was right and the sentence was wrong. A third of τ²-bench's information-reporting failures live here. |
 *
 * Nothing for a locale slip, a data-key miss or a step-count overrun: those are
 * metric outcomes, not places in a trajectory, and they show up as this case's
 * `failed_metrics` instead.
 */
export type DeviationCategory =
  | 'wrong_tool'
  | 'missing_call'
  | 'extra_call'
  | 'wrong_arguments'
  | 'tool_error'
  | 'reply_unsourced';

/** Whether the deviation is a place in the trajectory or a sentence in the reply. */
export type DeviationLocus = 'step' | 'reply';

const CATEGORIES: readonly string[] = [
  'wrong_tool',
  'missing_call',
  'extra_call',
  'wrong_arguments',
  'tool_error',
  'reply_unsourced',
];

/**
 * At one position, which category is the cause and which is the fallout. A
 * divergence outranks the error of the very call it condemned; both outrank a
 * sentence, which the model wrote after every step.
 */
const TIE_ORDER: Readonly<Record<DeviationCategory, number>> = {
  wrong_tool: 0,
  missing_call: 0,
  extra_call: 0,
  wrong_arguments: 1,
  tool_error: 2,
  reply_unsourced: 3,
};

/**
 * One located deviation, in the shape the committed result file carries it:
 * indices and tool names, never the visitor's text (`failure-attribution.ts`).
 *
 * `step_index` for a `missing_call` is `trajectory.length` — the slot the call
 * would have taken, which is one past the last real index and is the honest
 * answer to "where is the step that isn't there".
 */
export interface Deviation {
  readonly category: DeviationCategory;
  readonly locus: DeviationLocus;
  readonly step_index: number | null;
  readonly claim_index: number | null;
  /** The tool the deviating step called; `null` when no call was made there. */
  readonly tool_name: string | null;
  /** The tool the accepted chain wanted there; `null` when the chain had ended. */
  readonly expected_tool: string | null;
}

/**
 * The one door a category becomes a record through, so the vocabulary is closed
 * at RUN time and not only at compile time. A future signal that invents a name
 * fails loudly here instead of silently widening the column a reader groups by.
 */
export function deviationCategory(name: string): DeviationCategory {
  if (!CATEGORIES.includes(name)) {
    throw new RangeError(`unknown failure category "${name}" — one of: ${CATEGORIES.join(', ')}`);
  }
  return name as DeviationCategory;
}

/** Every deviation this turn shows, unordered. */
export function deviationsOf(
  inputs: ExportedAgentInput,
  metadata: ExportedAgentExpected | undefined,
  output: TranscriptResult,
): readonly Deviation[] {
  const divergence = chainDivergenceOf(metadata, output);
  return [
    ...(divergence === null ? [] : [divergence]),
    ...misArguedSteps(output),
    ...erroredSteps(output),
    ...unsourcedClaims(decidedClaimsOf(inputs, output)),
  ];
}

function wrongArgumentsAt(toolName: string, index: number): Deviation {
  return {
    category: deviationCategory('wrong_arguments'),
    locus: 'step',
    step_index: index,
    claim_index: null,
    tool_name: toolName,
    expected_tool: null,
  };
}

/**
 * Signal 2's other answer: every completed call whose two witnesses disagree.
 *
 * The predicate is `OfficialArgumentCorrectness`' own — a settled step that
 * published no `params` scores 0, and so does one whose `params` are not deeply
 * equal to the `args` the stream carried. When the transcript read offered no
 * second witness at all (`paramsRecorded` false) the metric emits nothing, so
 * there is nothing to place either.
 */
function misArguedSteps(output: TranscriptResult): Deviation[] {
  if (!output.paramsRecorded) return [];
  return output.trajectory
    .map((step, index) => ({ step, index }))
    .filter((placed) => placed.step.status === 'ok' && !settledAsAsked(placed.step))
    .map((placed) => wrongArgumentsAt(placed.step.toolName, placed.index));
}

function settledAsAsked(step: TranscriptStep): boolean {
  return step.params !== null && isDeepStrictEqual(step.args, step.params);
}

function toolErrorAt(toolName: string, index: number): Deviation {
  return {
    category: deviationCategory('tool_error'),
    locus: 'step',
    step_index: index,
    claim_index: null,
    tool_name: toolName,
    expected_tool: null,
  };
}

/** Signal 2: every settled failure, in trajectory order. */
function erroredSteps(output: TranscriptResult): Deviation[] {
  return output.trajectory
    .map((step, index) => ({ step, index }))
    .filter((placed) => placed.step.status === 'error')
    .map((placed) => toolErrorAt(placed.step.toolName, placed.index));
}

function unsourcedClaimAt(claimIndex: number): Deviation {
  return {
    category: deviationCategory('reply_unsourced'),
    locus: 'reply',
    step_index: null,
    claim_index: claimIndex,
    tool_name: null,
    expected_tool: null,
  };
}

/** Signal 3: the claims the verifier decided against, in the order written. */
function unsourcedClaims(claims: readonly DecidedClaim[]): Deviation[] {
  return claims
    .filter((claim) => claim.verdict === 0)
    .map((claim) => unsourcedClaimAt(claim.index));
}

function rankOf(deviation: Deviation, steps: number): readonly number[] {
  return [
    deviation.step_index ?? steps,
    TIE_ORDER[deviation.category],
    deviation.claim_index ?? 0,
  ];
}

function compareRanks(left: readonly number[], right: readonly number[]): number {
  const differing = left.findIndex((value, index) => value !== right[index]);
  return differing === -1 ? 0 : (left[differing] ?? 0) - (right[differing] ?? 0);
}

/** The deviations in the order they happened — earliest first. */
export function orderedDeviations(
  deviations: readonly Deviation[],
  steps: number,
): readonly Deviation[] {
  return [...deviations].sort((left, right) =>
    compareRanks(rankOf(left, steps), rankOf(right, steps)),
  );
}
