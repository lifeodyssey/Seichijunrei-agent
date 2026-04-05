// ---------------------------------------------------------------------------
// TypeScript contract mirroring the Python backend (interfaces/public_api.py,
// agents/intent_agent.py, domain/entities.py).  Every field matches the
// backend exactly — consult those files for the source of truth.
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
  };
  message: string;
  status: "ok" | "empty" | "partial";
}

/** data shape when intent = general_qa | unclear */
export interface QAData {
  intent: string;
  confidence: number;
  status: "info" | "needs_clarification";
  message: string;
}

// ── Top-level request / response ───────────────────────────────────────────

export interface RuntimeRequest {
  text: string;
  session_id?: string | null;
  locale?: "ja" | "zh" | "en";
  model?: string | null;
  include_debug?: boolean;
  selected_point_ids?: string[];
  origin?: string | null;
}

export interface PublicAPIError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface StepEvent {
  tool: string;
  status: "running" | "done";
}

export interface RouteHistoryRecord {
  route_id: string | null;
  bangumi_id: string;
  origin_station: string | null;
  point_count: number;
  status: string;
  created_at: string; // ISO 8601
}

export interface ConversationRecord {
  session_id: string;
  title: string | null;
  first_query: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

export interface UIDescriptor {
  component: string;
  props: Record<string, unknown>;
}

export interface RuntimeResponse {
  success: boolean;
  status: string;
  intent: Intent;
  session_id: string | null;
  message: string;
  data: SearchResultData | RouteData | QAData;
  session: {
    interaction_count: number;
    route_history_count: number;
    last_intent?: string | null;
    last_status?: string | null;
    last_message?: string;
  };
  route_history: RouteHistoryRecord[];
  errors: PublicAPIError[];
  debug?: Record<string, unknown> | null;
  ui?: UIDescriptor;
}

// ── Frontend-only types ────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: RuntimeResponse;
  loading?: boolean;
  timestamp: number;
  steps?: StepEvent[];
}

// ── Type guards ────────────────────────────────────────────────────────────

export function isSearchData(data: RuntimeResponse["data"]): data is SearchResultData {
  return "results" in data && !("route" in data);
}

export function isRouteData(data: RuntimeResponse["data"]): data is RouteData {
  return "route" in data;
}

export function isQAData(data: RuntimeResponse["data"]): data is QAData {
  return data.status === "info" || data.status === "needs_clarification";
}
