/**
 * Shape catalog rows into the payloads a session stores under a ref.
 *
 * Port of `apps/agent/src/animichi/agents/catalog_adapter.py`. The model never
 * sees any of this — it gets the ref and a row count — but the web's SD-9
 * frames are rendered from exactly these fields, so the field names are the
 * Python ones.
 */

import type { Itinerary, Point } from "@animichi/contract";
import { proxyScreenshots } from "@animichi/agent";
import { localizedCityName } from "@animichi/agent";
import type {
  ItineraryPayload,
  ItinerarySummary,
  SearchMetadata,
  SearchResultPayload,
} from "./catalog-tool-session.ts";

/** How a search result was found: by work, by place, or by merging the works a
 * user picked at once (#1288). */
export type SearchKind = SearchResultPayload["kind"];

/** Every row's city in the reader's language, and its screenshot proxied. */
function readableRows(points: Point[], locale: string): Point[] {
  return proxyScreenshots(points).map((row) =>
    row.city ? { ...row, city: localizedCityName(row.city, locale) } : row,
  );
}

/** Display metadata derived from the first row, or nothing when there are none. */
function searchMetadata(points: Point[]): SearchMetadata | null {
  const head = points[0];
  if (!head) return null;
  return {
    anime_title: head.title,
    anime_title_cn: head.title_cn,
    cover_url: head.cover_url,
    data_origin: "catalog",
    source: "catalog",
  };
}

/** Shape catalog points into the payload one ref names. */
export function buildSearchResultPayload(
  points: Point[],
  kind: SearchKind,
  animeId: string | null,
  partial: boolean,
  locale: string,
): SearchResultPayload {
  return {
    kind,
    rows: readableRows(points, locale),
    row_count: points.length,
    metadata: searchMetadata(points),
    anime_id: animeId,
    partial,
  };
}

/** The headline numbers the web renders above a route. */
function itinerarySummary(itinerary: Itinerary, orderedCount: number): ItinerarySummary {
  const timed = itinerary.timed_itinerary;
  return {
    point_count: itinerary.point_count,
    total_minutes: timed.total_minutes,
    total_distance_m: timed.total_distance_m,
    clusters: timed.spot_count ?? 0,
    with_coordinates: orderedCount,
    without_coordinates: 0,
  };
}

/** Shape a planned route into the payload its own ref names. */
export function buildItineraryPayload(itinerary: Itinerary, sourceRef: string | null, locale: string): ItineraryPayload {
  const ordered = readableRows(itinerary.ordered_points, locale);
  return {
    ordered_points: ordered,
    timed_itinerary: itinerary.timed_itinerary,
    summary: itinerarySummary(itinerary, ordered.length),
    source_ref: sourceRef,
  };
}
