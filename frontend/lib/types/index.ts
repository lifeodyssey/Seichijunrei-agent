// ---------------------------------------------------------------------------
// Barrel export — all types available from @/lib/types
// ---------------------------------------------------------------------------

export type {
  Intent,
  PilgrimagePoint,
  NearbyGroup,
  ResultsMeta,
  SearchResultData,
  RouteData,
  LocationCluster,
  TimedStop,
  TransitLeg,
  TimedItinerary,
  QAData,
  ClarifyData,
  ClarifyCandidate,
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
import type { SearchResultData, RouteData, QAData, ClarifyData, TimedRouteData } from "./domain";

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function isSearchData(data: RuntimeResponse["data"]): data is SearchResultData {
  return isObjectRecord(data) && "results" in data && !("route" in data);
}

export function isRouteData(data: RuntimeResponse["data"]): data is RouteData {
  return isObjectRecord(data) && "route" in data;
}

export function isQAData(data: RuntimeResponse["data"]): data is QAData {
  return isObjectRecord(data) && (data.status === "info" || data.status === "needs_clarification");
}

export function isClarifyData(data: RuntimeResponse["data"]): data is ClarifyData {
  return isObjectRecord(data) && data.status === "needs_clarification" && "question" in data;
}

export function isTimedRouteData(data: RuntimeResponse["data"]): data is TimedRouteData {
  if (!isObjectRecord(data) || !("route" in data)) return false;
  const route = (data as { route?: unknown }).route;
  return isObjectRecord(route) && "timed_itinerary" in route;
}
