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
  import("mapbox-gl").then((mod: { prewarm?: () => void; default?: { prewarm?: () => void } }) => {
    const fn = mod.prewarm ?? mod.default?.prewarm;
    if (typeof fn === "function") fn();
  });
}
