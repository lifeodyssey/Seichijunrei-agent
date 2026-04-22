/**
 * Shared geographic utilities — haversine distance + formatting.
 *
 * Used by: ResultPanel, SpotDetail, RouteConfirm, NearbyBubble, NearbyMap.
 */

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

/** Haversine great-circle distance in kilometres. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Haversine great-circle distance in metres. */
export function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

// ---------------------------------------------------------------------------
// Distance formatting
// ---------------------------------------------------------------------------

/** Format a distance in metres to a human-readable string (e.g. "120m", "1.5km"). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Format an optional distance in metres.
 * Returns empty string for null/undefined inputs.
 */
export function formatDistanceOpt(m?: number | null): string {
  if (m == null) return "";
  return formatDistance(m);
}
