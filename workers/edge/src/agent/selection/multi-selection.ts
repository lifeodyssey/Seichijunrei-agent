/**
 * `plan_multi` — the works a user picked at once, merged and routed (card
 * #1288).
 *
 * Port of `selection.py::execute_multi_selection`. It is the answer to an
 * `anime_ambiguity` clarification where the user said "these, all of them": the
 * works are fetched in PARALLEL, merged deterministically (`merged-works.ts`),
 * and the merge is routed as one itinerary.
 *
 * The terminal vocabulary is Python's and each word is a different fact about
 * the pick, which is why one `error` would not do:
 *   `error`     nothing could be fetched, or the route could not be planned;
 *   `partial`   some work is still syncing — the rows are shown, no route yet;
 *   `empty`     every work answered, and none of them has a spot published;
 *   `too_large` more spots than a route may carry.
 * Only `ok` consumes the clarification. A pick that failed leaves the question
 * open, because the user may reasonably pick differently.
 */
import { CatalogUnavailableError, type CatalogClient } from "../tools/catalog-client.ts";
import { buildItineraryPayload } from "../tools/search-result-payload.ts";
import type { SelectionAnswer } from "../session/turn-answer.ts";
import type { TurnCatalogSession } from "../session/turn-catalog-session.ts";
import type { CurrentAnime, OrderedCandidate } from "../tools/catalog-tool-session.ts";
import { mergedWorks, omittedTitles, type FetchedWork, type MergedWorks } from "./merged-works.ts";
import { multiMessage, type MultiOutcome } from "@animichi/agent";
import { selectionRecord, type SelectionRecord } from "./selection-record.ts";

/** The tool name this step is settled and streamed under. */
export const MULTI_SELECTION_STEP = "plan_multi";

/** Python's `MAX_ITINERARY_POINT_IDS` — more spots than a route may carry. */
export const MAX_ITINERARY_POINT_IDS = 500;

/** Every picked work fetched at once; the ones that failed simply drop out. */
async function fetchedWorks(catalog: CatalogClient, picked: readonly string[]): Promise<FetchedWork[]> {
  const asked = [...picked];
  const settled = await Promise.allSettled(asked.map((id) => catalog.pointsByBangumiId(id)));
  return settled.flatMap((outcome, index) =>
    outcome.status === "fulfilled" ? [{ bangumiId: asked[index] ?? "", result: outcome.value }] : [],
  );
}

/** The record a merge that cannot be routed settles under. */
function unrouted(status: MultiOutcome, merged: MergedWorks): SelectionRecord {
  return selectionRecord({ status, search: merged.payload });
}

/**
 * Why this merge stops short of a route, or null when nothing stops it — in
 * Python's own order, which is load-bearing: a work still syncing outranks an
 * empty merge, so a pick whose only published work has no spots yet is told to
 * retry rather than told the works are empty.
 *
 * `partial` is read off the FETCHES rather than off `merged.payload.partial`,
 * because that flag also carries "a work contributed nothing" — a fact that
 * must not by itself stop a route the remaining works can carry.
 */
function blocked(merged: MergedWorks, fetched: readonly FetchedWork[], picked: number): MultiOutcome | null {
  const rows = merged.payload.rows;
  if (fetched.some((work) => work.result.partial === true)) return "partial";
  if (rows.length === 0) return fetched.length < picked ? "error" : "empty";
  return rows.length > MAX_ITINERARY_POINT_IDS ? "too_large" : null;
}

/**
 * The route over the merged rows, or the word that says why there is none.
 *
 * Python could answer `too_large` here too, from the catalog's typed
 * `RouteTooManyClustersError` / `RouteTooManyPointsError`; the TS catalog port
 * degrades every failure into one untyped `CatalogUnavailableError` (#1253), so
 * a route the catalog refuses for size arrives as `error`. The size ceiling
 * this tier CAN see — `MAX_ITINERARY_POINT_IDS` — is still checked before the
 * call, which is where Python checked it too.
 */
async function routedMerge(
  catalog: CatalogClient,
  merged: MergedWorks,
  candidates: readonly OrderedCandidate[],
  locale: string,
): Promise<SelectionRecord> {
  const pointIds = merged.payload.rows.map((row) => row.id).filter(Boolean);
  const itinerary = await planned(catalog, pointIds);
  if (itinerary === null || itinerary.point_count < 1) return unrouted("error", merged);
  const omitted = omittedTitles(merged.omittedIds, candidates);
  const route = buildItineraryPayload(itinerary, null, locale);
  return selectionRecord({ status: "ok", search: merged.payload, itinerary: route, omitted });
}

/** The catalog's route, or null for the one failure the port has. */
async function planned(catalog: CatalogClient, pointIds: string[]) {
  try {
    return await catalog.planItinerary(pointIds, {});
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return null;
    throw error;
  }
}

/**
 * Fetch, merge, route — the whole step, with every failure answered.
 *
 * `Promise.allSettled` is `asyncio.gather(return_exceptions=True)`: one work
 * the catalog cannot serve must not sink the works it can, and a rejected fetch
 * is simply a work that contributed nothing (`merged-works.ts` then reports it
 * omitted, which is what makes the merge partial).
 */
export async function multiSelectionRecord(
  catalog: CatalogClient,
  picked: readonly string[],
  candidates: readonly OrderedCandidate[],
  locale: string,
): Promise<SelectionRecord> {
  const fetched = await fetchedWorks(catalog, picked);
  if (fetched.length === 0) return selectionRecord({ status: "error" });
  const merged = mergedWorks(picked, fetched, locale);
  const stopped = blocked(merged, fetched, picked.length);
  if (stopped !== null) return unrouted(stopped, merged);
  return await routedMerge(catalog, merged, candidates, locale);
}

/** The work this pick resolved the session to — `null` when it picked several,
 * because a session about three works is about no single one
 * (`_set_current_anime`). */
function pickedAnime(picked: readonly string[], candidates: readonly OrderedCandidate[]): CurrentAnime | null {
  const bangumiId = picked.length === 1 ? picked[0] : undefined;
  if (bangumiId === undefined) return null;
  const candidate = candidates.find((offered) => offered.id === bangumiId);
  return { bangumiId, title: candidate?.title ?? bangumiId };
}

/** The record's status word, refused down to `error` when it is not one. */
const MULTI_OUTCOMES: readonly MultiOutcome[] = ["ok", "empty", "partial", "too_large", "error"];
function multiOutcome(status: string): MultiOutcome {
  return MULTI_OUTCOMES.find((known) => known === status) ?? "error";
}

/**
 * The session effects of a settled record, and the answer it becomes.
 *
 * The merged search is stored on every path that produced one, exactly where
 * Python stored it — BEFORE the terminal branches — so even a `partial` pick
 * leaves the rows behind a ref the next turn can route. Only `ok` sets the
 * current anime and consumes the question.
 */
export function multiSelectionAnswer(
  session: TurnCatalogSession,
  record: SelectionRecord,
  picked: readonly string[],
  locale: string,
): SelectionAnswer {
  const candidates = session.envelope.pendingClarification?.candidates ?? [];
  if (record.search !== null) session.storeSearchResult(record.search);
  const status = multiOutcome(record.status);
  if (status !== "ok" || record.itinerary === null) return unroutedAnswer(record, status, locale);
  session.storeItinerary(record.itinerary);
  session.setCurrentAnime(pickedAnime(picked, candidates));
  session.clearPendingClarification();
  return routedAnswer(record, multiMessage(locale, "ok", record.omitted));
}

function routedAnswer(record: SelectionRecord, message: string): SelectionAnswer {
  const { search, itinerary } = record;
  return { of: "multi", intent: MULTI_SELECTION_STEP, search, itinerary, status: "ok", success: true, message };
}

function unroutedAnswer(record: SelectionRecord, status: MultiOutcome, locale: string): SelectionAnswer {
  const message = multiMessage(locale, status);
  return {
    of: "multi",
    intent: MULTI_SELECTION_STEP,
    search: record.search,
    itinerary: null,
    status,
    success: false,
    message,
  };
}
