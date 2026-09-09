/**
 * Whether a pick may answer the question the session has open (card #1288).
 *
 * A port of `apps/agent/src/animichi/agents/selection.py::
 * validate_candidate_selection`, and the ONE place a pick is judged. It answers
 * a value rather than a boolean because the verdict carries the thing the
 * caller needs next — which of the two deterministic paths the pending reason
 * puts this pick on — so no branch downstream has to re-read the reason and
 * re-derive it.
 *
 * Four rules, in Python's order, and the order is part of the port: a stale id
 * is refused before membership, so a pick for a question the session has
 * already answered can never be told whether its ids were real ones.
 *   1. there must BE an open question;
 *   2. the pick must name that question's own id (the stale guard — see
 *      `session-envelope.ts` for why this tier mints one at all);
 *   3. every id picked must be one the question offered;
 *   4. the cardinality must match the question's mode: `anime_ambiguity` takes
 *      as many works as the user wants merged, `place_ambiguity` takes exactly
 *      one place, and any other reason has no selection mode at all.
 */
import type { PendingClarification } from "../session/session-envelope.ts";
import { SELECTION_EXPIRED, SELECTION_WRONG_MODE } from "@animichi/agent";

/** Which deterministic path a validated pick takes. */
export type SelectionMode = "anime_ambiguity" | "place_ambiguity";

/** A pick that may proceed: the ids it named, and the path it is on. */
export interface ValidatedSelection {
  readonly candidateIds: readonly string[];
  readonly mode: SelectionMode;
  /** The question it answers, so the executors need not re-read the envelope
   * to find the candidate titles and coordinates they were offered with. */
  readonly pending: PendingClarification;
}

/**
 * A pick that may not proceed, carrying the sentence the visitor is shown.
 *
 * Python raised `SelectionError(ValueError)` with the message as its only
 * payload, and the route rendered that message; the text is therefore wire, not
 * a log line, which is why it lives in `selection-copy.ts` beside the rest.
 */
export class SelectionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionRefused";
  }
}

/** Rule 4: `anime_ambiguity` merges many, `place_ambiguity` takes exactly one. */
function modeFor(reason: string, picked: number): SelectionMode {
  if (reason === "anime_ambiguity") return "anime_ambiguity";
  if (reason === "place_ambiguity" && picked === 1) return "place_ambiguity";
  throw new SelectionRefused(SELECTION_WRONG_MODE);
}

/** Rules 1 and 2, together because they share one refusal on purpose. */
function answerable(pending: PendingClarification | null, clarificationId: number): PendingClarification {
  if (pending === null || pending.id !== clarificationId) throw new SelectionRefused(SELECTION_EXPIRED);
  return pending;
}

/** Rule 3: every id picked is one the question offered. */
function offered(pending: PendingClarification, candidateIds: readonly string[]): void {
  const ids = new Set(pending.candidates.map((candidate) => candidate.id));
  const known = candidateIds.length > 0 && candidateIds.every((id) => ids.has(id));
  if (!known) throw new SelectionRefused(SELECTION_EXPIRED);
}

/** The verdict on one pick, or a `SelectionRefused` carrying its own words. */
export function validateCandidateSelection(
  pending: PendingClarification | null,
  candidateIds: readonly string[],
  clarificationId: number,
): ValidatedSelection {
  const open = answerable(pending, clarificationId);
  offered(open, candidateIds);
  return { candidateIds, mode: modeFor(open.reason, candidateIds.length), pending: open };
}
