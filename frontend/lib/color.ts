/** Shared oklch color value helper used across nearby/chips components. */
export function colorValue(hue: number, chroma: number, lightness: number): string {
  return `oklch(${lightness}% ${chroma} ${hue})`;
}
