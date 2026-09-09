/**
 * `plan_selected` — a route over the points the user ticked (card #1288).
 *
 * Port of `apps/agent/src/animichi/agents/selected_route.py::
 * execute_selected_itinerary`. No model is consulted and no clarification is
 * involved: the browser already knows which spots it wants routed
 * (`apps/web`'s `useSendSelectedPoints`), so the whole turn is one catalog call
 * whose answer is the reply.
 *
 * The ORIGIN is ported exactly, including the part that looks like a bug and is
 * not: `_parse_coordinate_origin` only accepts `"lat,lng"` inside the valid
 * ranges, so a place NAME on that field reaches the catalog as no origin at
 * all. The catalog's `ItineraryInput.origin` would accept the string, but
 * making it do so here would change what a route means on a wire this tier is
 * only a fallback for.
 */
import type { LatLng } from "@animichi/contract";
import { CatalogUnavailableError, type CatalogClient } from "../tools/catalog-client.ts";
import { buildItineraryPayload } from "../tools/search-result-payload.ts";
import type { TurnCatalogSession } from "../session/turn-catalog-session.ts";
import type { SelectionAnswer } from "../session/turn-answer.ts";
import {
  CATALOG_ROUTE_UNAVAILABLE,
  NO_CATALOG_ROUTE_DATA,
  selectedRouteMessage,
} from "@animichi/agent";
import {
  SELECTION_ERROR,
  refusedRecord,
  selectionRecord,
  type SelectionRecord,
} from "./selection-record.ts";

/** The tool name this step is settled and streamed under. */
export const SELECTED_ROUTE_STEP = "plan_selected";

/**
 * The two ways this step fails, kept apart in the RECORD because Python said
 * two different things about them — `CATALOG_ROUTE_UNAVAILABLE` when the
 * catalog would not answer, `"No catalog route data"` when it answered with no
 * route. Both reach the wire as one `status: "error"`, so the distinction has
 * nowhere else to live.
 */
const ROUTE_UNAVAILABLE = "unavailable";
const ROUTE_EMPTY = "no_route";

/**
 * One component of a `"lat,lng"` pair, or `NaN` when there is none.
 *
 * The blank check is the whole function. Python reached this through
 * `float(part)`, which RAISES on `""` and on `" "`; `Number("")` is `0`, a
 * perfectly valid coordinate — so without it an origin of `","` becomes the
 * point 0°N 0°E in the Gulf of Guinea and the route is planned from there.
 */
function coordinate(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? "";
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/** Python's `_parse_coordinate_origin`: a `"lat,lng"` pair in range, or none. */
export function coordinateOrigin(origin: string | null): LatLng | undefined {
  const parts = (origin ?? "").split(",");
  if (parts.length !== 2) return undefined;
  const lat = coordinate(parts[0]);
  const lng = coordinate(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
}

/** The route the catalog planned, as this step settles it. */
async function planned(
  catalog: CatalogClient,
  pointIds: readonly string[],
  origin: string | null,
  locale: string,
): Promise<SelectionRecord> {
  const itinerary = await catalog.planItinerary([...pointIds], { origin: coordinateOrigin(origin) });
  if (itinerary.point_count < 1) return refusedRecord(ROUTE_EMPTY);
  return selectionRecord({ status: "ok", itinerary: buildItineraryPayload(itinerary, null, locale) });
}

/**
 * The catalog call, with its own failures answered rather than thrown.
 *
 * `CatalogUnavailableError` is the one failure the port collapses everything
 * into (#1253), so Python's two branches — a contract violation and a transient
 * catalog error — land on the same record here; both rendered the same
 * `CATALOG_ROUTE_UNAVAILABLE` fallback anyway, since the typed-error table
 * `build_error_message` consults has no counterpart on this port yet.
 */
export async function selectedItineraryRecord(
  catalog: CatalogClient,
  pointIds: readonly string[],
  origin: string | null,
  locale: string,
): Promise<SelectionRecord> {
  try {
    return await planned(catalog, pointIds, origin, locale);
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return refusedRecord(ROUTE_UNAVAILABLE);
    throw error;
  }
}

/** Python's two failure texts, told apart by the record's own status. */
function failureText(record: SelectionRecord): string {
  return record.status === ROUTE_EMPTY ? NO_CATALOG_ROUTE_DATA : CATALOG_ROUTE_UNAVAILABLE;
}

/** The refusal, in the one shape the wire has for both of them. */
function refusedRoute(record: SelectionRecord): SelectionAnswer {
  const message = failureText(record);
  return { of: "selected", intent: SELECTED_ROUTE_STEP, itinerary: null, status: SELECTION_ERROR, success: false, message };
}

/**
 * The session effects of a settled record, and the answer it becomes.
 *
 * Applied from the RECORD rather than inside the catalog call, so a replayed
 * step stores the same itinerary the first attempt did (`selection-record.ts`).
 * The pending clarification is dropped on the success path only, exactly as
 * `_build_success_result` set `state.pending_clarification = None` while
 * `_error_result` left it for the user to answer again.
 */
export function selectedItineraryAnswer(
  session: TurnCatalogSession,
  record: SelectionRecord,
  locale: string,
): SelectionAnswer {
  const itinerary = record.status === "ok" ? record.itinerary : null;
  if (itinerary === null) return refusedRoute(record);
  session.storeItinerary(itinerary);
  session.clearPendingClarification();
  const message = selectedRouteMessage(locale, itinerary.summary.point_count);
  return { of: "selected", intent: SELECTED_ROUTE_STEP, itinerary, status: "ok", success: true, message };
}
