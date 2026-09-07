/**
 * The claims a reply's PROSE makes, extracted deterministically (E-3 #1382,
 * spec §十 10.3).
 *
 * The prose is free text, so the spec's first move is to bound what may be
 * judged at all: 「散文是自由文本，所以它的覆盖面必须先被界死 —— 只判以下三类可判定
 * 的断言，其余一律记未测量」. This module is that boundary, and it is deliberately
 * a POOR extractor: everything it does not extract is unmeasured, and unmeasured
 * is a legitimate answer here while a wrong 0 is not.
 *
 * TWO FORMS ARE EXTRACTED, AND NOTHING ELSE.
 *
 * - **A quoted span** is a NAME claim. Quoting is the one place a generated
 *   reply marks "this is a name I am asserting" in a way a regular expression
 *   can see, in all three languages the agent answers in (`「」`, `『』`, `《》`,
 *   `“”`, `"`). An unquoted title or place name is not extracted — a run of CJK
 *   with no delimiter has no decidable end, and guessing one is how a verifier
 *   starts inventing claims to fail. Whether a span is a work title or a place
 *   is decided later, by which source answers it (`reply-claim-verifier.ts`).
 * - **A digit run followed by a counting word** is a COUNT claim. A bare number
 *   is not: "10分" is a duration and "3日" is a date, neither of which any tool
 *   return counts. The vocabulary below is closed, and a count phrased outside
 *   it is unmeasured rather than guessed at.
 *
 * NAME CLAIMS ARE CAPPED AT `NAME_LIMIT` CHARACTERS and may not span a line. A
 * quoted sentence is quoted speech, not an asserted name, and the cap is what
 * keeps this extractor from turning the agent's own phrasing into claims.
 */

/** One decidable assertion in the reply's prose. */
export type ReplyClaim =
  | { readonly of: "name"; readonly text: string }
  | { readonly of: "count"; readonly value: number };

/** The longest quoted span still read as a name rather than as speech. */
const NAME_LIMIT = 40;

/** The quote pairs a reply marks a name with, one expression per pair so an
 * opener can only be closed by its own partner. */
const NAME_QUOTES: readonly RegExp[] = [
  new RegExp(`「([^「」\\n]{1,${String(NAME_LIMIT)}})」`, "gu"),
  new RegExp(`『([^『』\\n]{1,${String(NAME_LIMIT)}})』`, "gu"),
  new RegExp(`《([^《》\\n]{1,${String(NAME_LIMIT)}})》`, "gu"),
  new RegExp(`“([^“”\\n]{1,${String(NAME_LIMIT)}})”`, "gu"),
  new RegExp(`"([^"\\n]{1,${String(NAME_LIMIT)}})"`, "gu"),
];

/**
 * The counting words a number has to carry to be read as a count of ROWS.
 *
 * They are the units the three data shapes are counted in — search rows,
 * itinerary stops, clarification candidates — in the agent's three reply
 * languages. `件` / `箇所` / `个` and `spots` / `stops` are the same fact in
 * different scripts; minutes, kilometres, episodes and dates are absent on
 * purpose, because no tool return answers them and a verifier that judged them
 * would score its own vocabulary gap as the agent's error.
 */
const COUNT_UNITS =
  "件|箇所|ヶ所|ケ所|か所|カ所|スポット|地点|个|處|处|places?|spots?|locations?|results?|points?|stops?|candidates?";

const COUNT_CLAIM = new RegExp(`([0-9０-９]+)\\s*(?:${COUNT_UNITS})`, "giu");

/** Full-width digits as their ASCII selves, so the count is parsed as a NUMBER
 * and never compared as text: a reply that writes `３件` states the same three
 * a `row_count` of 3 does. */
function asciiDigits(text: string): string {
  return text.replace(/[０-９]/gu, (digit) => String.fromCodePoint((digit.codePointAt(0) ?? 0) - 0xfee0));
}

/** Every quoted span of the prose, in the order they were written. */
function nameClaims(message: string): ReplyClaim[] {
  const spans = NAME_QUOTES.flatMap((quotes) => [...message.matchAll(quotes)]);
  return spans
    .map((match) => (match[1] ?? "").trim())
    .filter((text) => text !== "")
    .map((text) => ({ of: "name", text }) as const);
}

/** Every number the prose states as a count of rows. */
function countClaims(message: string): ReplyClaim[] {
  return [...message.matchAll(COUNT_CLAIM)].map((match) => ({
    of: "count",
    value: Number(asciiDigits(match[1] ?? "")),
  }));
}

/** Everything in this reply that can be checked against the environment. */
export function replyClaimsOf(message: string): readonly ReplyClaim[] {
  return [...nameClaims(message), ...countClaims(message)];
}

/**
 * A name as it is COMPARED: NFKC-folded, lowercased, whitespace collapsed.
 *
 * Folding is what lets `３` equal `3` and `！` equal `!` across the scripts one
 * session mixes; it is not a loosening of the comparison itself, which stays
 * EQUALITY. Containment would let a sequel pass as its original — `ラブライブ! 2`
 * matching `ラブライブ!` — and that is precisely the untraceable claim this
 * verifier exists to catch.
 */
export function normalizedName(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}
