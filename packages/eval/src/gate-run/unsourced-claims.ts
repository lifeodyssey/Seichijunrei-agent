/**
 * Signal 3 of the first-error rules: WHICH claim the final-reply verifier could
 * not trace (E-4 #1383 over E-3 #1382, spec §十 10.4 「第一条无法溯源的断言」).
 *
 * `reply-claim-verifier.ts` answers one number per turn — `Math.min` over the
 * decided verdicts, which is the first offending claim expressed as a SCORE.
 * Attribution needs the claim itself, so this module asks the same two questions
 * of each claim in turn and keeps the index.
 *
 * THE EXTRACTION AND THE SOURCES ARE E-3'S, IMPORTED, NOT COPIED. `replyClaimsOf`
 * bounds what may be judged at all and `claimSourcesOf` enumerates the five
 * places a fact may have come from; re-deriving either would be a second, quietly
 * different verifier. What IS restated here is the two-line verdict per form,
 * because E-3 keeps it private behind the fold — and `test/gate-run-unsourced-claims.test.ts`
 * pins the restatement to the original by asserting, over every turn it builds,
 * that the minimum of these verdicts is exactly what the verifier reports and
 * that "no decided claim" is exactly the verifier's `{}`. An E-3 edit that moved
 * one and not the other turns that test red, which is the only defence against
 * drift that does not require editing E-3.
 */
import type { ExportedAgentInput } from '../dataset-roundtrip.ts';
import { claimSourcesOf, type ClaimSources } from '../evaluators/reply-claim-sources.ts';
import { normalizedName, replyClaimsOf, type ReplyClaim } from '../evaluators/reply-claims.ts';
import type { TranscriptResult } from '../turn-transcript.ts';

/** One claim the verifier could decide: where it was written, and the answer. */
export interface DecidedClaim {
  /** Index into `replyClaimsOf(message)` — the reply's own claim order. */
  readonly index: number;
  readonly of: ReplyClaim['of'];
  /** The claim as written. EVIDENCE ONLY: it is the model's prose and never
   * enters the committed result file (`failure-attribution.ts`). */
  readonly text: string;
  /** 1 traceable, 0 unsourced. Undecidable claims are not in this list at all. */
  readonly verdict: number;
}

/** E-3's `nameVerdict`: equality after NFKC folding, never containment. */
function nameVerdict(text: string, sources: ClaimSources): number | null {
  const name = normalizedName(text);
  if (sources.names.has(name) || sources.userText.includes(name)) return 1;
  return sources.rowsPublished ? 0 : null;
}

/** E-3's `countVerdict`: compared as a number against every published count. */
function countVerdict(value: number, sources: ClaimSources): number | null {
  if (sources.counts.size === 0) return null;
  return sources.counts.has(value) ? 1 : 0;
}

function verdictOf(claim: ReplyClaim, sources: ClaimSources): number | null {
  return claim.of === 'name' ? nameVerdict(claim.text, sources) : countVerdict(claim.value, sources);
}

function claimText(claim: ReplyClaim): string {
  return claim.of === 'name' ? claim.text : String(claim.value);
}

function decided(claim: ReplyClaim, index: number, sources: ClaimSources): DecidedClaim[] {
  const verdict = verdictOf(claim, sources);
  if (verdict === null) return [];
  return [{ index, of: claim.of, text: claimText(claim), verdict }];
}

/** Every claim this reply made that the environment could answer, in order. */
export function decidedClaimsOf(
  inputs: ExportedAgentInput,
  output: TranscriptResult,
): readonly DecidedClaim[] {
  const sources = claimSourcesOf(inputs, output);
  return replyClaimsOf(output.message).flatMap((claim, index) => decided(claim, index, sources));
}
