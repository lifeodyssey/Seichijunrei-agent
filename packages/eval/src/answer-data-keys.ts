/**
 * The `data` keys one answer published — Python's `_available_data_keys`,
 * ported once (W3-2 #1300).
 *
 * Its own module rather than a section of `turn-transcript.ts` because it reads
 * nothing off the frames. That shaper turns a stream into calls and an answer
 * part; this turns the PART into the vocabulary the dataset's
 * `expected_data_keys` is written in, and `DataKeysPresent` reads the result
 * rather than re-deriving the rule — so this file is that rule's one
 * declaration, and the oracle publishes Python's own answer for it.
 */
import type { AnswerPart } from "./turn-transcript.ts";

/** The intents whose `data` may publish a search, and those that may publish a
 * route — `_available_data_keys`' own two lists. The gating is not redundant
 * with the contract: `RouteData` allows BOTH members, so a `plan_route` answer
 * carrying search rows would otherwise report a key Python never reports. */
const SEARCH_INTENTS: ReadonlySet<string> = new Set(["search_bangumi", "search_nearby", "plan_multi"]);
const ROUTE_INTENTS: ReadonlySet<string> = new Set(["plan_route", "plan_selected", "plan_multi"]);

/** Python's clarification pair: published together whenever a question is
 * actually pending, which on the wire is a `candidates` member. */
function clarificationKeys(candidates: unknown): readonly string[] {
  return candidates === undefined ? [] : ["candidates", "reason"];
}

/**
 * Python's `_available_data_keys`, read off the published `data` instead of the
 * session registry the wire does not carry.
 *
 * The two are the same fact from opposite ends: `_available_data_keys` asks
 * whether the turn's provenance still resolves to a stored payload, and the
 * `data` member exists exactly when `turn-answer-part.ts` found that payload to
 * project. What is compared against these keys is the dataset's own
 * `expected_data_keys` (`results` / `route` / `reason` + `candidates`), so the
 * names here are that vocabulary and not the wire's.
 */
export function dataKeysOf(part: AnswerPart | null): readonly string[] {
  if (part === null) return [];
  if (part.intent === "clarify") return clarificationKeys(part.data.candidates);
  const keys: string[] = [];
  if (SEARCH_INTENTS.has(part.intent) && part.data.results !== undefined) keys.push("results");
  if (ROUTE_INTENTS.has(part.intent) && part.data.itinerary !== undefined) keys.push("route");
  return keys.sort();
}
