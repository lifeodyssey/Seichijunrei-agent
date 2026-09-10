import { SelectionResult } from "./selection-result.ts";
import type { SelectionRequest } from "./selection-input.ts";
import { multiMessage, placeMessage, selectedRouteMessage, CATALOG_ROUTE_UNAVAILABLE } from "./selection-copy.ts";

type Outcome = Omit<SelectionResult, "request" | "response" | "rows" | "omitted" | "currentAnime"> &
  Partial<Pick<SelectionResult, "rows" | "omitted" | "currentAnime">>;

export function selectionResult(request: SelectionRequest, outcome: Outcome): SelectionResult {
  const result = { ...outcome, request, rows: outcome.rows ?? [], omitted: outcome.omitted ?? [], currentAnime: outcome.currentAnime ?? null };
  const success = result.status === "ok" || (result.step === "search_nearby" && result.status === "empty");
  return SelectionResult.parse({ ...result, response: { intent: result.step, status: result.status, success,
    message: message(result), data: responseData(result) } });
}

function message(result: Omit<SelectionResult, "response">): string {
  if (result.step === "plan_multi") return multiMessage(result.request.locale, result.status, result.omitted);
  if (result.step === "plan_selected") return result.itinerary ? selectedRouteMessage(result.request.locale, result.itinerary.point_count) : CATALOG_ROUTE_UNAVAILABLE;
  return placeMessage(result.request.locale, result.status === "ok" || result.status === "empty" ? result.status : "error");
}

function responseData(result: Omit<SelectionResult, "response">) {
  const results = { kind: result.step === "search_nearby" ? "nearby" : "multi", rows: result.rows, row_count: result.rows.length };
  return { ...(result.step !== "plan_selected" ? { results } : {}), ...(result.itinerary ? { itinerary: result.itinerary } : {}) };
}
