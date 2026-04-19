// ---------------------------------------------------------------------------
// Domain types — entities and value objects from the backend domain layer.
// ---------------------------------------------------------------------------

// ── Intent values ──────────────────────────────────────────────────────────

export type Intent =
  | "search_bangumi"
  | "search_nearby"
  | "plan_route"
  | "plan_selected"
  | "answer_question"
  | "greet_user"
  | "general_qa"
  | "clarify"
  | "unclear"
  | "unknown";

// ── Row-level types (SQL result rows) ──────────────────────────────────────

/** Single pilgrimage point returned by SQL/PostGIS queries. */
export interface PilgrimagePoint {
  id: string;
  name: string;           // Japanese name
  name_cn: string | null; // Chinese name
  episode: number | null;
  time_seconds: number | null;
  screenshot_url: string | null; // Anitabi public URL
  address?: string | null;       // legacy/demo-only field
  bangumi_id: string | null;
  latitude: number;
  longitude: number;
  title?: string | null;     // anime title (JP)
  title_cn?: string | null;  // anime title (CN)
  distance_m?: number | null; // present only in geo searches
  origin?: string | null;
}

// ── Response-level types (intent-specific data shapes) ─────────────────────

export interface ResultsMeta {
  rows: PilgrimagePoint[];
  row_count: number;
  strategy: "sql" | "geo" | "hybrid";
  status: "ok" | "empty";
  metadata?: Record<string, unknown>;
  summary?: {
    count: number;
    strategy: string;
    source: string;
    cache: string;
  };
}

/** data shape when intent = search_by_bangumi | search_by_location */
export interface SearchResultData {
  results: ResultsMeta;
  message: string;
  status: "ok" | "empty" | "partial";
}

/** data shape when intent = plan_route */
export interface RouteData {
  results: ResultsMeta;
  route: {
    ordered_points: PilgrimagePoint[];
    point_count: number;
    status: "ok" | "empty";
    summary?: {
      point_count: number;
      with_coordinates: number;
      without_coordinates: number;
    };
    timed_itinerary?: TimedItinerary;
  };
  message: string;
  status: "ok" | "empty" | "partial";
}

/** A physical location cluster with multiple anime screenshot points. */
export interface LocationCluster {
  center_lat: number;
  center_lng: number;
  points: PilgrimagePoint[];
  photo_count: number;
  cluster_id: string;
}

/** A stop on the route with arrival/departure times. */
export interface TimedStop {
  cluster_id: string;
  name: string;
  arrive: string;  // "HH:MM"
  depart: string;  // "HH:MM"
  dwell_minutes: number;
  lat: number;
  lng: number;
  photo_count: number;
  points: PilgrimagePoint[];
}

/** A walking segment between two stops. */
export interface TransitLeg {
  from_id: string;
  to_id: string;
  mode: "walk";
  duration_minutes: number;
  distance_m: number;
}

/** Complete timed route with stops, transit legs, and export data. */
export interface TimedItinerary {
  stops: TimedStop[];
  legs: TransitLeg[];
  total_minutes: number;
  total_distance_m: number;
  spot_count: number;
  pacing: "chill" | "normal" | "packed";
  start_time: string;
  export_google_maps_url: string[];
  export_ics: string;
}

/** data shape when intent = general_qa | unclear */
export interface QAData {
  intent: string;
  confidence: number;
  status: "info" | "needs_clarification";
  message: string;
}

/** A candidate item in a clarification response. */
export interface ClarifyCandidate {
  title: string;
  cover_url: string | null;
  spot_count: number;
  city: string;
}

/** data shape when intent = clarify (SSE clarify event merged into response) */
export interface ClarifyData {
  intent: string;
  confidence: number;
  status: "needs_clarification";
  message: string;
  question: string;
  options: string[];
  candidates?: ClarifyCandidate[];
}

export type TimedRouteData = RouteData & {
  route: { timed_itinerary: TimedItinerary };
};
