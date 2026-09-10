import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { Entry } from "@earendil-works/pi-agent-core/harness/session";
import { ORPCError } from "@orpc/client";
import type { createCatalogClient } from "./catalog-client.ts";
import { projectPilgrimage } from "./pilgrimage-projection.ts";
import { displayPoints } from "./search-result.ts";
import { SELECTION_EXPIRED, SELECTION_WRONG_MODE, PLACE_SELECTION_EXPIRED } from "./selection-copy.ts";
import { SelectionRequest, SelectionRefused } from "./selection-input.ts";
import type { SelectionResult } from "./selection-result.ts";
import { selectionResult } from "./selection-outcome.ts";
import { pointSelection } from "./selection-route.ts";
import { multiSelection } from "./selection-multi.ts";

export { SelectionRequest, SelectionRefused } from "./selection-input.ts";
export { SelectionResult } from "./selection-result.ts";
export { SELECTION_ENTRY, SelectionEntry, readSelectionEntry, selectionEntryProjector, selectionEntryData } from "./selection-entry.ts";
type Pending = NonNullable<ReturnType<typeof projectPilgrimage>["clarification"]>;

function candidateOffer(request: Extract<SelectionRequest, { of: "candidates" }>, entries: readonly Entry[]): Pending {
  const pending = projectPilgrimage(entries).clarification;
  if (!pending || pending.id !== request.clarificationId) throw new SelectionRefused(SELECTION_EXPIRED);
  if (!request.candidateIds.length || request.candidateIds.some((id) => !pending.candidates.some((candidate) => candidate.id === id))) throw new SelectionRefused(SELECTION_EXPIRED);
  if (pending.reason !== "anime_ambiguity" && !(pending.reason === "place_ambiguity" && request.candidateIds.length === 1)) throw new SelectionRefused(SELECTION_WRONG_MODE);
  return pending;
}

async function placeSelection(request: Extract<SelectionRequest, { of: "candidates" }>, pending: Pending, catalog: ReturnType<typeof createCatalogClient>, context: Context) {
  const place = pending.candidates.find((candidate) => candidate.id === request.candidateIds[0]);
  if (place?.lat === undefined || place.lng === undefined) throw new SelectionRefused(PLACE_SELECTION_EXPIRED);
  const { rows } = await catalog.nearby({ lat: place.lat, lng: place.lng, radius_m: place.effective_radius_m ?? 5000 }, { signal: context.abortSignal });
  return selectionResult(request, { step: "search_nearby", status: rows.length ? "ok" : "empty", clarificationId: pending.id, rows: displayPoints(rows, request.locale) });
}

/** Deterministic, read-only domain work shared by the native host and eval. */
export async function executeSelection(input: SelectionRequest, entries: readonly Entry[], catalog: ReturnType<typeof createCatalogClient>, context: Context): Promise<SelectionResult> {
  const request = SelectionRequest.parse(input);
  if (request.of === "points") return pointSelection(request, entries, catalog, context);
  const pending = candidateOffer(request, entries);
  if (pending.reason === "anime_ambiguity") return multiSelection(request, pending, catalog, context);
  try { return await placeSelection(request, pending, catalog, context); }
  catch (error) {
    if (!(error instanceof ORPCError) || error.status < 500) throw error;
    return selectionResult(request, { step: "search_nearby", status: "error", clarificationId: pending.id });
  }
}
