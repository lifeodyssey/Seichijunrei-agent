import type { PilgrimagePoint } from "../../lib/types";
import { haversineKm } from "../../lib/geo";

// ---------------------------------------------------------------------------
// Episode-range helpers
// ---------------------------------------------------------------------------

const EP_RANGE = 4; // episodes per bucket

export function epRangeLabel(ep: number): string {
  const start = Math.floor((ep - 1) / EP_RANGE) * EP_RANGE + 1;
  const end = start + EP_RANGE - 1;
  return `EP ${start}-${end}`;
}

export function buildEpRanges(points: PilgrimagePoint[]): string[] {
  const ranges = new Set<string>();
  for (const p of points) {
    if (p.episode != null) {
      ranges.add(epRangeLabel(p.episode));
    }
  }
  // Sort ranges numerically by their start episode.
  // Extract the first run of digits (e.g. "EP 5-8" → "5") for comparison.
  return Array.from(ranges).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
    const numB = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
    return numA - numB;
  });
}

// ---------------------------------------------------------------------------
// Area helpers — derive region from coordinates
// ---------------------------------------------------------------------------

/** Known areas with center coordinates and radius (km). */
export const KNOWN_AREAS: { name: string; lat: number; lng: number; r: number }[] = [
  { name: "宇治", lat: 34.888, lng: 135.802, r: 4 },
  { name: "伏見", lat: 34.930, lng: 135.764, r: 5 },
  { name: "京都市", lat: 34.985, lng: 135.758, r: 12 },
  { name: "大阪", lat: 34.686, lng: 135.520, r: 15 },
  { name: "奈良", lat: 34.685, lng: 135.805, r: 10 },
  { name: "神戸", lat: 34.690, lng: 135.195, r: 12 },
];

function pointArea(p: PilgrimagePoint): string | null {
  for (const area of KNOWN_AREAS) {
    if (haversineKm(p.latitude, p.longitude, area.lat, area.lng) <= area.r) {
      return area.name;
    }
  }
  return null;
}

/** Build area labels, using `otherLabel` for points not matching any known area. */
export function buildAreasI18n(points: PilgrimagePoint[], otherLabel: string): string[] {
  const areas = new Set<string>();
  for (const p of points) areas.add(pointArea(p) ?? otherLabel);
  return Array.from(areas).sort();
}

export function pointAreaI18n(p: PilgrimagePoint, otherLabel: string): string {
  return pointArea(p) ?? otherLabel;
}
