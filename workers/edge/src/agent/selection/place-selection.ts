/**
 * The place a user picked from a `place_ambiguity` clarification (card #1288).
 *
 * Port of `selection.py::execute_place_selection`, and the reason it is not
 * simply "call `search_nearby` again": the candidate the user picked was
 * GEOCODED when the question was asked, and its coordinates were offered with
 * it. Re-geocoding the label would be a second lookup that can disagree with
 * the one the user answered — so this path consumes the staged coordinates and
 * never geocodes at all.
 *
 * It answers `search_nearby`, not an intent of its own: from the visitor's side
 * the result IS a nearby search, and Python emitted the same intent under the
 * same `NearbyMap` component.
 */
import { CatalogUnavailableError, type CatalogClient } from "../tools/catalog-client.ts";
import { buildSearchResultPayload } from "../tools/search-result-payload.ts";
import type { OrderedCandidate } from "../tools/catalog-tool-session.ts";
import type { SelectionAnswer } from "../session/turn-answer.ts";
import type { TurnCatalogSession } from "../session/turn-catalog-session.ts";
import { SelectionRefused } from "./candidate-selection.ts";
import { PLACE_SELECTION_EXPIRED, placeMessage, type PlaceOutcome } from "@animichi/agent";
import { SELECTION_ERROR, selectionRecord, type SelectionRecord } from "./selection-record.ts";

/** The tool name this step is settled and streamed under — the same one the
 * model's own nearby search uses, because it is the same search. */
export const PLACE_SELECTION_STEP = "search_nearby";

/** Python's `candidate.effective_radius_m or 5_000`. */
export const DEFAULT_PLACE_RADIUS_M = 5_000;

/** The picked place, with the coordinates it was offered with. */
export interface StagedPlace {
  readonly around: { lat: number; lng: number };
  readonly radiusM: number;
}

/**
 * The staged coordinates of the picked candidate.
 *
 * Refuses rather than degrades: a candidate the question no longer carries, or
 * one whose coordinates are missing, cannot be searched around at all, and
 * Python raised `SelectionError` here for exactly that reason.
 */
export function stagedPlace(candidates: readonly OrderedCandidate[], candidateId: string): StagedPlace {
  const picked = candidates.find((candidate) => candidate.id === candidateId);
  if (picked?.lat === undefined || picked.lng === undefined) {
    throw new SelectionRefused(PLACE_SELECTION_EXPIRED);
  }
  return {
    around: { lat: picked.lat, lng: picked.lng },
    radiusM: picked.effective_radius_m ?? DEFAULT_PLACE_RADIUS_M,
  };
}

/** The nearby search around the staged place, with its failure answered. */
export async function placeSelectionRecord(
  catalog: CatalogClient,
  place: StagedPlace,
  locale: string,
): Promise<SelectionRecord> {
  try {
    const rows = await catalog.nearby(place.around, place.radiusM);
    const search = buildSearchResultPayload(rows, "nearby", null, false, locale);
    return selectionRecord({ status: rows.length > 0 ? "ok" : "empty", search });
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return selectionRecord({ status: SELECTION_ERROR });
    throw error;
  }
}

/** The record's status word, refused down to `error` when it is not one. */
const PLACE_OUTCOMES: readonly PlaceOutcome[] = ["ok", "empty", "error"];
function placeOutcome(status: string): PlaceOutcome {
  return PLACE_OUTCOMES.find((known) => known === status) ?? "error";
}

/**
 * The session effects of a settled record, and the answer it becomes.
 *
 * The question is consumed on the two paths that ANSWERED it — a search that
 * found nothing still answered "which place did you mean" — and left open on
 * the one that did not, which is `_place_error` leaving the state untouched.
 */
export function placeSelectionAnswer(
  session: TurnCatalogSession,
  record: SelectionRecord,
  locale: string,
): SelectionAnswer {
  const status = placeOutcome(record.status);
  const search = status === "error" ? null : record.search;
  if (search === null) return placeAnswer(null, "error", locale);
  session.storeSearchResult(search);
  session.clearPendingClarification();
  return placeAnswer(search, status, locale);
}

function placeAnswer(
  search: SelectionRecord["search"],
  status: PlaceOutcome,
  locale: string,
): SelectionAnswer {
  const message = placeMessage(locale, status);
  const success = status !== "error";
  return { of: "place", intent: PLACE_SELECTION_STEP, search, status, success, message };
}
