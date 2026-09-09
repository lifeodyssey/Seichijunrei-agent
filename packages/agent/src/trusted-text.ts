/** External text normalized to one line and bounded by complete UTF-8 characters. */

const ELLIPSIS = "…";
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** The ellipsis counts toward the same UTF-8 byte budget. */
const ELLIPSIS_BYTES = ENCODER.encode(ELLIPSIS).length;

/** Control characters, DEL, and every line/paragraph separator a JSON string
 * can carry — tested by code point rather than by a character class, because a
 * regex holding them is a lint error and the set is short enough to name. */
const SEPARATORS = new Set([0x85, 0x2028, 0x2029]);

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f || SEPARATORS.has(code);
}

/** The UTF-8 byte length of a string, which is what both caps are measured in. */
export function encodedBytes(value: string): number {
  return ENCODER.encode(value).length;
}

/** Control characters gone and runs of whitespace collapsed to one space. */
function collapsed(value: string): string {
  return Array.from(value)
    .map((character) => (isControl(character) ? " " : character))
    .join("")
    .split(/\s+/u)
    .filter((word) => word !== "")
    .join(" ");
}

/** The last index at or before `limit` that does not split a code point. */
function boundary(bytes: Uint8Array, limit: number): number {
  let cut = limit;
  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) cut -= 1;
  return cut;
}

/** Sanitized, then truncated to at most `maxBytes` encoded UTF-8 bytes. */
export function trustedText(value: string, maxBytes: number): string {
  const clean = collapsed(value);
  const bytes = ENCODER.encode(clean);
  if (bytes.length <= maxBytes) return clean;
  const suffix = maxBytes < ELLIPSIS_BYTES ? "" : ELLIPSIS;
  const limit = Math.max(0, Math.floor(maxBytes) - encodedBytes(suffix));
  return DECODER.decode(bytes.subarray(0, boundary(bytes, limit))) + suffix;
}
