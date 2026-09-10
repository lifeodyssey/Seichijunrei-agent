import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import type { Point } from "@animichi/contract/models";
import { ORPCError } from "@orpc/client";
import type { createCatalogClient } from "./catalog-client.ts";
import { projectPilgrimage, RouteDetails } from "./pilgrimage-projection.ts";
import { SearchResultDetails, displayPoints } from "./search-result.ts";
import { SelectionRefused, type SelectionRequest } from "./selection-input.ts";
import { selectionResult } from "./selection-outcome.ts";
import { SELECTION_EXPIRED } from "./selection-copy.ts";
import { readSelectionEntry } from "./selection-entry.ts";

function offeredPoints(entries: readonly Entry[]): Map<string, Point> {
  return new Map([...entries].sort((a, b) => a.seq - b.seq).flatMap(pointsIn).map((point) => [point.id, point]));
}

function pointsIn(entry: Entry): Point[] {
  const selection = readSelectionEntry(entry)?.result;
  if (selection) return selection.itinerary?.ordered_points ?? selection.rows;
  if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.isError) return [];
  const search = SearchResultDetails.safeParse(entry.message.details), route = RouteDetails.safeParse(entry.message.details);
  return search.success ? search.data.rows : route.success ? route.data.itinerary.ordered_points : [];
}

export function coordinateOrigin(origin: string | null) {
  const parts = origin?.split(",") ?? [];
  if (parts.length !== 2 || parts.some((part) => !part.trim())) return undefined;
  const lat = Number(parts[0]), lng = Number(parts[1]);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
}

export async function planSelectedPoints(catalog: ReturnType<typeof createCatalogClient>, points: Point[], origin: string | null, locale: string, context: Context) {
  const itinerary = await catalog.planItinerary({ point_ids: points.map((point) => point.id), origin: coordinateOrigin(origin) }, { signal: context.abortSignal });
  if (itinerary.ordered_points.some((point) => !points.some((offered) => offered.id === point.id && offered.latitude === point.latitude && offered.longitude === point.longitude))) throw new Error("Catalog returned an unoffered route point");
  return { ...itinerary, ordered_points: displayPoints(itinerary.ordered_points, locale) };
}

export async function pointSelection(request: Extract<SelectionRequest, { of: "points" }>, entries: readonly Entry[], catalog: ReturnType<typeof createCatalogClient>, context: Context) {
  const offered = offeredPoints(entries), points = request.pointIds.map((id) => offered.get(id));
  if (!points.length || points.some((point) => point === undefined)) throw new SelectionRefused(SELECTION_EXPIRED);
  const clarificationId = projectPilgrimage(entries).clarification?.id ?? null;
  if (points.length > 500) return selectionResult(request, { step: "plan_selected", status: "too_large", clarificationId });
  return selectedRoute(request, points.filter((point) => point !== undefined), clarificationId, catalog, context);
}

async function selectedRoute(request: Extract<SelectionRequest, { of: "points" }>, points: Point[], clarificationId: number | null, catalog: ReturnType<typeof createCatalogClient>, context: Context) {
  try {
    const itinerary = await planSelectedPoints(catalog, points, request.origin, request.locale, context);
    return selectionResult(request, { step: "plan_selected", status: itinerary.point_count ? "ok" : "error", clarificationId,
      ...(itinerary.point_count ? { itinerary } : {}) });
  } catch (error) {
    if (!(error instanceof ORPCError) || error.status < 500) throw error;
    return selectionResult(request, { step: "plan_selected", status: "error", clarificationId });
  }
}
