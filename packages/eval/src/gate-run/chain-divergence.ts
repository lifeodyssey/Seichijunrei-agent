/**
 * Signal 1 of the first-error rules: where the trajectory left the case's
 * accepted chains (E-4 #1383, spec §十 10.4 「轨迹与用例可接受链的首处分歧」).
 *
 * THE CHAIN VOCABULARY IS NOT RE-DERIVED. `evaluators/accepted-chains.ts` owns
 * which chains a case accepts — the ANY-of-N stages, the bypass stages that
 * accept only the empty chain (`plan_selected`, `plan_multi`, `greet_user`),
 * `dict.fromkeys` ordering and all — and this module only asks it, off the
 * case's acceptable STAGES and nothing else. A selection in the inputs is not a
 * chain fact: #1439 deleted the short-circuit that made one, because a *place*
 * selection does not bypass the model — it re-runs `search_nearby`, and its
 * stage already said so. That deletion is what leaves `wrong_tool` and
 * `missing_call` derivable here from the accepted chains alone: against
 * `[['search_nearby']]`, `D3_place_selection_radius` calling nothing is a
 * `missing_call` at position 0 and calling something else is a `wrong_tool`,
 * where the short-circuit's `[[]]` could only ever have said `extra_call`.
 * Nothing here decides an expected score either; that rule belongs to the
 * evaluators and this is a report-only reader of what they scored.
 *
 * THE COMPARISON IS POSITIONAL, AND THAT IS A THIRD READING ON PURPOSE.
 * `tool_correctness` compares MULTISETS and `trajectory_match` takes an LCS;
 * neither answers "at which position did it first go wrong", which is exactly
 * what the book asks for. In-order alignment is the reading `TrajectoryMatch`
 * is parameterised with (`order='in_order'`), so this is that evaluator's own
 * notion of order, asked a different question.
 *
 * IT COMPARES THE SAME CALLS THE EVALUATORS DO — `completedCalls`, i.e.
 * `status === "ok"`, which is `include_failed=False` on both official
 * evaluators. An errored or unsettled attempt is not a chain position; it is
 * signal 2's business, and counting it here would shift every later index.
 * The index reported, though, is into the FULL trajectory, so a reader can look
 * the step up where it really sits.
 *
 * AN UNSETTLED CALL SUSPENDS THIS SIGNAL ENTIRELY, and that is a decision rather
 * than an omission. `"unsettled"` means the call was MADE and the stream never
 * said how it ended, so the completed-call sequence is a partial record of what
 * the turn did. Comparing a partial record positionally puts the blame in the
 * wrong place in both directions: the oracle's `unsettled_call_excluded_from_chain`
 * — one unsettled `search_nearby` against the chain `['search_nearby']` — read as
 * `missing_call`, 「该调用的工具没有调用」 about a call that was made, which is
 * exactly the harness observation gap `first-deviation.ts` refuses to blame on
 * the model; and a `wrong_tool` after an unsettled step could be condemning a
 * position the unmeasured call already filled. Such a turn keeps signals 2 and 3
 * and otherwise lands in `unattributed`, which is the honest answer: the metrics
 * still score it (`tool_correctness` and `trajectory_match` exclude the call,
 * `max_tool_calls` counts it), and the record says the rules could not place it.
 *
 * THE MOST FORGIVING CHAIN WINS, mirroring `bestOverChains`. The evaluators keep
 * the best score over the accepted chains, so the model is never blamed for
 * departing from a chain it was not following: the divergence reported is the
 * LATEST first-divergence across the chains. If any chain matches outright there
 * is no divergence at all, and a case with NO accepted chain has nothing to
 * diverge from — `_best(..., empty=1.0)`, "there was nothing to violate".
 */
import type { ExportedAgentExpected } from '../dataset-roundtrip.ts';
import { acceptedChainsForCase, type ModelCallChain } from '../evaluators/accepted-chains.ts';
import type { StepStatus, TranscriptResult } from '../turn-transcript.ts';
import { deviationCategory, type Deviation } from './first-deviation.ts';

/** The one status a chain position is made of (`transcript-view.ts::completedCalls`). */
const COMPLETED: StepStatus = 'ok';

/** The state that means "made, never settled" — not a failure, an unknown. */
const UNSETTLED: StepStatus = 'unsettled';

/** One completed call, remembered with the trajectory index it really sits at. */
interface PlacedCall {
  readonly position: number;
  readonly stepIndex: number;
  readonly toolName: string;
}

/** A chain's own first divergence: where in the CHAIN, and what it looked like. */
interface ChainDivergence {
  readonly position: number;
  readonly deviation: Deviation;
}

export function chainDivergenceOf(
  metadata: ExportedAgentExpected | undefined,
  output: TranscriptResult,
): Deviation | null {
  const chains = acceptedChainsForCase(metadata);
  if (chains.length === 0 || witnessedPartially(output)) return null;
  const calls = placedCalls(output);
  const divergences = chains.map((chain) => divergenceFrom(calls, chain, output.trajectory.length));
  if (divergences.includes(null)) return null;
  return latestOf(divergences)?.deviation ?? null;
}

/** Whether any call was made and never settled, which makes the completed-call
 * sequence an incomplete record of the turn rather than the whole of it. */
function witnessedPartially(output: TranscriptResult): boolean {
  return output.trajectory.some((step) => step.status === UNSETTLED);
}

/** `completedCalls`' predicate — `status === "ok"`, `include_failed=False` —
 * applied while the trajectory index is still in hand. */
function placedCalls(output: TranscriptResult): readonly PlacedCall[] {
  const placed: PlacedCall[] = [];
  output.trajectory.forEach((step, stepIndex) => {
    if (step.status !== COMPLETED) return;
    placed.push({ position: placed.length, stepIndex, toolName: step.toolName });
  });
  return placed;
}

/** The chain a reader should be shown: the one the trajectory followed longest. */
function latestOf(divergences: readonly (ChainDivergence | null)[]): ChainDivergence | null {
  const found = divergences.filter((one) => one !== null);
  return found.reduce<ChainDivergence | null>(
    (best, one) => (best === null || one.position > best.position ? one : best),
    null,
  );
}

/** `null` when this chain accepts the trajectory outright. */
function divergenceFrom(
  calls: readonly PlacedCall[],
  chain: ModelCallChain,
  trajectoryLength: number,
): ChainDivergence | null {
  const length = Math.max(calls.length, chain.length);
  for (let position = 0; position < length; position += 1) {
    const called = calls[position];
    const expected = chain[position];
    const divergence = divergenceAt(position, called, expected, trajectoryLength);
    if (divergence !== null) return divergence;
  }
  return null;
}

function divergenceAt(
  position: number,
  called: PlacedCall | undefined,
  expected: string | undefined,
  trajectoryLength: number,
): ChainDivergence | null {
  if (called === undefined && expected !== undefined) {
    return { position, deviation: missingCall(trajectoryLength, expected) };
  }
  if (called !== undefined && expected === undefined) {
    return { position, deviation: extraCall(called) };
  }
  if (called === undefined || called.toolName === expected) return null;
  return { position, deviation: wrongTool(called, expected ?? null) };
}

function missingCall(trajectoryLength: number, expected: string): Deviation {
  return {
    category: deviationCategory('missing_call'),
    locus: 'step',
    step_index: trajectoryLength,
    claim_index: null,
    tool_name: null,
    expected_tool: expected,
  };
}

function extraCall(called: PlacedCall): Deviation {
  return {
    category: deviationCategory('extra_call'),
    locus: 'step',
    step_index: called.stepIndex,
    claim_index: null,
    tool_name: called.toolName,
    expected_tool: null,
  };
}

function wrongTool(called: PlacedCall, expected: string | null): Deviation {
  return {
    category: deviationCategory('wrong_tool'),
    locus: 'step',
    step_index: called.stepIndex,
    claim_index: null,
    tool_name: called.toolName,
    expected_tool: expected,
  };
}
