/**
 * Does a resolved work conflict with the specific title the user asked for?
 *
 * Port of `looks_like_wrong_variant` in
 * `apps/agent/src/animichi/agents/title_matching.py` — the guard that turns a
 * parent-series or wrong-season hit into `not_found` rather than confidently
 * answering about the wrong work. Only the conflict half is ported; the alias
 * index that module also serves belongs to the catalog, not to a tool.
 *
 * `String.prototype.toLowerCase` stands in for Python's `str.casefold`. They
 * differ only on characters (ß, ﬁ) that no catalog title carries.
 */

const NON_ALPHANUMERIC = /[^\p{L}\p{N}]/gu;

/** NFKC-fold, lowercase, and drop everything that is not a letter or digit. */
export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replaceAll(NON_ALPHANUMERIC, "");
}

/** How many leading characters two strings share. */
function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

/** The query names a longer or divergent work than this title does. */
function variantConflict(query: string, title: string): boolean {
  if (title.length > 0 && query.includes(title) && query.length - title.length >= 2) return true;
  const prefix = commonPrefixLength(query, title);
  return prefix >= 4 && query.length - prefix >= 2 && title.length - prefix >= 2;
}

/** True when the resolved titles look like a different entry in the same series. */
export function looksLikeWrongVariant(query: string, titles: (string | undefined)[]): boolean {
  const normalizedQuery = normalizeTitle(query);
  const candidates = titles.filter((title) => Boolean(title)).map((title) => normalizeTitle(title ?? ""));
  if (candidates.includes(normalizedQuery)) return false;
  return candidates.some((title) => variantConflict(normalizedQuery, title));
}
