/**
 * Mapbox GL prewarm — starts WebGL context + shader compilation early.
 *
 * Call this when search results arrive (before user clicks "map" tab).
 * Saves ~800ms when the map actually renders.
 *
 * Safe to call multiple times — only runs once.
 */

let prewarmed = false;

export function prewarmMapbox(): void {
  if (prewarmed || typeof window === "undefined") return;
  prewarmed = true;

  // Dynamic import so this module stays SSR-safe
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  import("mapbox-gl").then((mod: any) => {
    const prewarm = mod.prewarm ?? mod.default?.prewarm;
    if (typeof prewarm === "function") prewarm();
  });
}
