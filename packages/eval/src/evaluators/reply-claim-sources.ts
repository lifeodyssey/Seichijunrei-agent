/**
 * Everything a reply is ALLOWED to have got its facts from (E-3 #1382, spec §十
 * 10.3).
 *
 * The spec makes completeness a hard requirement rather than a nicety —
 * 「可溯源来源必须完整列举，否则它会把对的判成错的」— so the enumeration is
 * written out here and nowhere else. FIVE sources; the question each one
 * answers is 「这句话在上下文里有出处吗」, not 「环境替它作证了吗」 (see the
 * leniency note at the end):
 *
 * 1. **This run's calls** — each settled step's `output`, which the edge fills
 *    with the outcome `details` (`workers/edge/src/agent/tools/catalog-tool-outcomes.ts`:
 *    `anime_title`, `row_count`, `candidate_ids`, `ordered_point_ids`), AND the
 *    ARGUMENTS the same step carried, in both records the wire publishes:
 *    `args` off the stream and `params` off the transcript read. The arguments
 *    are context in two independent ways — #1377 replays every assistant
 *    tool-call message verbatim, and `run_steps.input` is what the status bar's
 *    retention line quotes back (`memory/rescued-entity.ts`: `resolve_anime.title`,
 *    `search_nearby.location`).
 * 2. **This reply's own `data` rows** — the stored payload projected onto the
 *    answer part (`workers/edge/src/agent/session/turn-answer-part.ts`
 *    `searchResultsWire` / `itineraryWire` / `clarificationWire`). Rows do NOT
 *    travel through a tool's `details` (`session/minted-refs.ts`: "rows belong
 *    in neither"), so this source is not a subset of the first — a place name
 *    exists ONLY here.
 * 3. **The user's own words.** This turn's `query`, plus the earlier prompts
 *    this runner really sent as user messages for the same case
 *    (`case-submissions.ts`: a case's `context.message_history` becomes N+1
 *    posts on one session). Both are `user` messages in the very context the
 *    measured turn answers from, so a name the reply gives back is sourced.
 * 4. **The prior runs' calls** (§九 9.1 / #1377), read off the earlier
 *    submissions' own streams (`prior-turn-returns.ts`) — arguments and returns
 *    alike, for the same reason as source 1. Counting only "this run" is the
 *    mistake the spec names: 「只认『本次 run』会与 §九 直接冲突」.
 * 5. **The `<agent_status>` bar** (§九 9.3 / #1379), which the model 「几乎无条件
 *    地相信」. Line by line (`workers/edge/src/agent/session/agent-status.ts`
 *    `statusLines`), and which source covers each:
 *
 *    | Bar line | What it states | Covered by |
 *    |---|---|---|
 *    | `resolvedAnimeLine` | the resolved title + bangumi id | 1 / 4 — a `resolve_anime` return's `anime_title` |
 *    | `openQuestionLine` | the reason and the candidate **ids** — no titles | 1 / 4 (`candidate_ids`), and 5 below for a seeded question |
 *    | pacing (`factLines`) | a three-value enum | nothing: not a name and not a count |
 *    | scene references | the point the user selected, in their words | 3, and 2 when the rows are published |
 *    | `retentionLines` | a call ARGUMENT, verbatim (`run_steps.input`) | 1 / 4, via the arguments |
 *    | `toolCallLines` | `tool ×N` for this run | nothing: it counts CALLS, and a count claim is about rows |
 *
 *    The one line this side cannot reach through another source is the open
 *    question of a SEEDED case (E-1 #1380): its prefix was posted by
 *    `CaseLifecycle.setup()` rather than by a `/v1/chat` turn, so no stream
 *    exists for source 4 to read. `inputs.seeded_pending` is that witness — its
 *    `candidate_ids` are what the bar prints, and its `ordered_candidates`
 *    titles are what the seeding turn's own clarify return offered
 *    (`trajectory-prefix-case.ts`), which is why the titles count too.
 *
 * WHAT IS NOT A SOURCE: the dataset's recorded `assistant` turns. A replay
 * produces the real agent's answers to the same prompts, not the fixture's
 * (`case-submissions.ts` says so), so a fixture reply is not a record of
 * anything staging returned.
 *
 * THE ONE DELIBERATE LENIENCY, stated rather than discovered later: a tool
 * ARGUMENT is the model's own words coming back, so a name that appears in an
 * argument and NOWHERE else is traceable without being corroborated — an
 * invented title passed to `resolve_anime` and then quoted scores 1. That is
 * the false-positive-avoiding direction, and it is the honest one: the value is
 * genuinely in the context, replayed verbatim and re-quoted by the bar, so the
 * claim is not unsourced. Catching it needs the outcome to be read as well,
 * which is `nonempty_results` and `tool_correctness`' job, not this column's.
 */
import type { ExportedAgentInput } from "../dataset-roundtrip.ts";
import { objectOrNull } from "../json-object.ts";
import { historyPromptsOf } from "../case-submissions.ts";
import type { AnswerPart, TranscriptResult, TranscriptStep } from "../turn-transcript.ts";
import { normalizedName } from "./reply-claims.ts";

/**
 * The keys a NAME can be published under, across all five sources.
 *
 * One vocabulary rather than one per source, because the wire uses one: a work
 * arrives as `anime_title` from a tool outcome and as `title` from a search
 * projection or a clarification candidate, and a place arrives as a `Point`'s
 * `name` / `name_cn` / `city` (`packages/contract/src/models.ts`).
 */
const NAME_KEYS: readonly string[] = [
  "anime_title",
  "title",
  "title_cn",
  "name",
  "name_cn",
  "city",
  "location",
];

/** The keys a COUNT is published under: the outcomes' own two counters. */
const COUNT_KEYS: readonly string[] = ["row_count", "point_count"];

/** The keys whose LENGTH is a count — the same fact as a counter, stated as a list. */
const COUNTED_LISTS: readonly string[] = [
  "candidate_ids",
  "place_candidate_ids",
  "ordered_point_ids",
  "ordered_candidates",
  "rows",
  "ordered_points",
  "candidates",
];

/** What the environment offered this reply, ready to be compared against. */
export interface ClaimSources {
  /** Every published name, normalized (`normalizedName`). */
  readonly names: ReadonlySet<string>;
  /** Every published count. */
  readonly counts: ReadonlySet<number>;
  /** The user's own words for this case, normalized and joined. */
  readonly userText: string;
  /** Whether this reply published rows at all — the spec's gate on judging
   * place names: 「仅当本次答复带 `data.results` / `data.itinerary` 时才判」. */
  readonly rowsPublished: boolean;
}

/** The names and counts collected while walking one source. */
interface Published {
  readonly names: string[];
  readonly counts: number[];
}

function stringsUnder(record: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  return keys.map((key) => record[key]).filter((value) => typeof value === "string");
}

function numbersUnder(record: Readonly<Record<string, unknown>>, keys: readonly string[]): number[] {
  return keys.map((key) => record[key]).filter((value) => typeof value === "number");
}

function listLengths(record: Readonly<Record<string, unknown>>): number[] {
  return COUNTED_LISTS.map((key) => record[key])
    .filter((value) => Array.isArray(value))
    .map((value) => value.length);
}

/** One record's own published facts, then everything nested under it. */
function collect(record: Readonly<Record<string, unknown>>, found: Published): void {
  found.names.push(...stringsUnder(record, NAME_KEYS));
  found.counts.push(...numbersUnder(record, COUNT_KEYS), ...listLengths(record));
  for (const value of Object.values(record)) walk(value, found);
}

/**
 * Every record reachable in one published value.
 *
 * A walk rather than a hand-written path per shape, because the same names sit
 * at four depths (`data.results.rows[]`, `data.itinerary.ordered_points[]`,
 * `data.candidates[]`, a tool return's own `details`) and a verifier that
 * missed one depth would report the reply as untraceable there. JSON off the
 * wire has no cycles to guard against.
 */
function walk(value: unknown, found: Published): void {
  const record = objectOrNull(value);
  if (record !== null) {
    collect(record, found);
    return;
  }
  if (Array.isArray(value)) for (const item of value) walk(item, found);
}

/** One call, from both ends: what it was asked to do and what it answered. */
function collectCall(step: TranscriptStep, found: Published): void {
  walk(step.output, found);
  walk(step.args, found);
  walk(step.params, found);
}

/** Sources 1 and 4: every call of this run and of the earlier ones. */
function everyCall(output: TranscriptResult, found: Published): void {
  for (const step of [...output.trajectory, ...output.priorTrajectory]) collectCall(step, found);
}

/** Source 3, as one text: containment is the right relation for "the user said
 * it", since the user's words are a sentence and not a published field. */
function userWords(inputs: ExportedAgentInput): string {
  return normalizedName([inputs.query, ...historyPromptsOf(inputs.context)].join("\n"));
}

/** The spec's gate for place names, read off the answer part rather than off
 * `dataKeys` — `dataKeysOf` reports Python's vocabulary and drops the rows a
 * `clarify` answer carries, and this asks a different question. */
function publishesRows(response: AnswerPart | null): boolean {
  if (response === null) return false;
  return response.data.results !== undefined || response.data.itinerary !== undefined;
}

/** The five sources, for one measured turn. */
export function claimSourcesOf(
  inputs: ExportedAgentInput,
  output: TranscriptResult,
): ClaimSources {
  const found: Published = { names: [], counts: [] };
  everyCall(output, found);
  walk(output.response?.data ?? {}, found);
  walk(inputs.seeded_pending, found);
  return {
    names: new Set(found.names.map(normalizedName)),
    counts: new Set(found.counts),
    userText: userWords(inputs),
    rowsPublished: publishesRows(output.response),
  };
}
