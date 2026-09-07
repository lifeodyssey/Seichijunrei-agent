/**
 * The final-reply verifier (E-3 #1382, spec §十 10.3) — does the prose say only
 * what the environment can vouch for?
 *
 * WHY IT EXISTS. 李博杰《深入理解 AI Agent》ch.7 「做对了但说错了」: of the 240
 * failed τ²-bench runs with an information-reporting requirement, 80 — a third
 * — had the environment state CORRECT and told the user something wrong, and
 * 「多数评估只检查环境状态」, so the overall success rate hides them. The eight
 * ported evaluators are exactly that kind: they read the trajectory and the
 * `data` KEYS (`metric-names.ts`), and not one of them asserts anything about
 * the sentence the visitor actually reads. The book's own localisation rule is
 * this module's algorithm: 「把答复里的每个事实断言与工具返回值逐条对齐，取第一条
 * 无法溯源或与工具返回矛盾的断言」— hence `Math.min`, which is that first
 * offending claim expressed as a score.
 *
 * DETERMINISTIC, NOT A JUDGE. No model is asked anything here. The price is
 * coverage, and the spec pays it deliberately: `reply-claims.ts` extracts only
 * quoted names and counted numbers, everything else is unmeasured, and
 * unmeasured is `{}` — 「判不了的断言记 `{}`（未测量），既不记 1 也不记 0」.
 *
 * THE TWO MISTAKES IT IS MOST LIKELY TO MAKE, both named by the spec:
 *
 * - **A vacuous pass.** A reply with nothing decidable in it must not score
 *   1.0; that would be an "all correct" computed from no evidence, and it would
 *   average into the column as if it were a measurement.
 * - **A false positive.** A true statement marked false because the verifier
 *   forgot where it could have come from. Two defences: the source enumeration
 *   is complete (`reply-claim-sources.ts`, five sources), and a name with NO
 *   answer is only scored 0 when this reply published rows to check it against
 *   — a prose-only answer's `data` is `{}` (`turn-answer-part.ts`), and a place
 *   name with nothing to compare it with is unmeasured rather than wrong.
 *
 * IT IS NOT AN `AgentTurnEvaluator`, AND THAT IS THE POINT. The registered
 * evaluators are the ones the exported dataset FILE names, resolved through
 * `Dataset.fromFile` (`evaluators/index.ts`), and every one of them is a port
 * scored against Python's oracle. This metric has no Python twin, must not
 * enter `metricNames()` (that list is aligned positionally with the committed
 * baseline — `metric-names.ts`), and must not show up as a surplus key in
 * `test/evaluator-parity.test.ts`. So it is a function the gate run calls over
 * the finished report instead (`gate-run/report-only-metrics.ts`), which is
 * also why it cannot leak into the bootstrap comparison.
 */
import type { ExportedAgentInput } from "../dataset-roundtrip.ts";
import type { TranscriptResult } from "../turn-transcript.ts";
import type { MetricRecord } from "./agent-evaluator.ts";
import { claimSourcesOf, type ClaimSources } from "./reply-claim-sources.ts";
import { normalizedName, replyClaimsOf, type ReplyClaim } from "./reply-claims.ts";

/** The column this verifier writes. Report-only: it is deliberately absent from
 * `metricNames()` until a full baseline cycle has been run (#1303). */
export const REPLY_CLAIM_METRIC = "reply_claim_traceability";

/** 1 verified, 0 contradicted or unsourced, `null` undecidable. */
type ClaimVerdict = number | null;

/**
 * A name is traceable when it EQUALS a published name, or when the user wrote
 * it. Equality, never containment: a sequel that reused its original's name
 * would pass, which is one of the untraceable claims this exists to catch.
 */
function nameVerdict(text: string, sources: ClaimSources): ClaimVerdict {
  const name = normalizedName(text);
  if (sources.names.has(name) || sources.userText.includes(name)) return 1;
  return sources.rowsPublished ? 0 : null;
}

/**
 * A count is compared as a NUMBER against every count the environment
 * published — `row_count`, the itinerary's `point_count`, and the lengths of
 * the row and candidate lists. A run that published no count at all decides
 * nothing.
 */
function countVerdict(value: number, sources: ClaimSources): ClaimVerdict {
  if (sources.counts.size === 0) return null;
  return sources.counts.has(value) ? 1 : 0;
}

function verdictOf(claim: ReplyClaim, sources: ClaimSources): ClaimVerdict {
  return claim.of === "name" ? nameVerdict(claim.text, sources) : countVerdict(claim.value, sources);
}

/** The verdicts this reply's prose can be given, undecidable ones dropped. */
function decidedVerdicts(inputs: ExportedAgentInput, output: TranscriptResult): number[] {
  const sources = claimSourcesOf(inputs, output);
  return replyClaimsOf(output.message)
    .map((claim) => verdictOf(claim, sources))
    .filter((verdict) => verdict !== null);
}

/**
 * The metric for one turn: the first offending claim, or nothing at all.
 *
 * `{}` when no claim could be decided — the same shape `NonemptyResults` and
 * `ArgumentCorrectness` use for "this does not apply here", which
 * `logfire/evals` reads as "emit nothing" rather than as a zero.
 */
export function replyClaimTraceability(
  inputs: ExportedAgentInput,
  output: TranscriptResult,
): MetricRecord {
  const verdicts = decidedVerdicts(inputs, output);
  return verdicts.length === 0 ? {} : { [REPLY_CLAIM_METRIC]: Math.min(...verdicts) };
}
