// ---------------------------------------------------------------------------
// Barrel export — all types available from @/lib/types
// ---------------------------------------------------------------------------

export type {
  Intent,
  PilgrimagePoint,
  ResultsMeta,
  SearchResultData,
  RouteData,
  LocationCluster,
  TimedStop,
  TransitLeg,
  TimedItinerary,
  QAData,
  TimedRouteData,
} from "./domain";

export type {
  RuntimeRequest,
  PublicAPIError,
  StepEvent,
  RouteHistoryRecord,
  ConversationRecord,
  UIDescriptor,
  RuntimeResponse,
} from "./api";

export type { ErrorCode, ChatMessage } from "./components";

// ── Type guards ────────────────────────────────────────────────────────────

import type { RuntimeResponse } from "./api";
import type { SearchResultData, RouteData, QAData, TimedRouteData } from "./domain";

export function isSearchData(data: RuntimeResponse["data"]): data is SearchResultData {
  return data != null && "results" in data && !("route" in data);
}

export function isRouteData(data: RuntimeResponse["data"]): data is RouteData {
  return data != null && "route" in data;
}

export function isQAData(data: RuntimeResponse["data"]): data is QAData {
  return data != null && (data.status === "info" || data.status === "needs_clarification");
}

export function isTimedRouteData(data: RuntimeResponse["data"]): data is TimedRouteData {
  return data != null && "route" in data && "timed_itinerary" in (data as RouteData).route;
}
