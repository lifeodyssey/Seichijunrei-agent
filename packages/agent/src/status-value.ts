/** External values cannot escape the tags, quotes or lines of agent status text. */
import { trustedText } from "./trusted-text.ts";

/** The byte budget one value gets, matching the ledgers' own per-value cap. */
export const STATUS_VALUE_MAX_BYTES = 96;

/** Everything the bar builds its own structure out of. A value may contain no
 * character that could end the wrapper, the tag, or the line. */
const STRUCTURAL = /[「」<>]/gu;

/** A value the bar can state on one line, inside its own structure, whatever
 * the world put in it. */
export function statusValue(raw: string): string {
  return trustedText(raw.replaceAll(STRUCTURAL, ""), STATUS_VALUE_MAX_BYTES);
}

/** The same value inside the quotes free text is stated in. The quotes are the
 * bar's, and `statusValue` is what makes them unforgeable from inside. */
export function quotedStatusValue(raw: string): string {
  return `「${statusValue(raw)}」`;
}
