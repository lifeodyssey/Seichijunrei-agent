// ---------------------------------------------------------------------------
// API types — request/response contracts for the public API layer.
// ---------------------------------------------------------------------------

import type {
  Intent,
  SearchResultData,
  RouteData,
  QAData,
  ClarifyData,
} from "./domain";

export interface RouteHistoryRecord {
  route_id: string | null;
  bangumi_id: string;
  origin_station: string | null;
  point_count: number;
  status: string;
  created_at: string; // ISO 8601
}

export interface RuntimeRequest {
  text: string;
  session_id?: string | null;
  locale?: "ja" | "zh" | "en";
  model?: string | null;
  include_debug?: boolean;
  selected_point_ids?: string[];
  origin?: string | null;
  origin_lat?: number | null;
  origin_lng?: number | null;
}

export interface PublicAPIError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export interface StepEvent {
  tool: string;
  status: "running" | "done" | "failed";
  thought?: string;
  observation?: string;
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
}

export interface RuntimeResponse {
  success: boolean;
  status: string;
  intent: Intent;
  session_id: string | null;
  message: string;
  data: SearchResultData | RouteData | QAData | ClarifyData;
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
  generated_title?: string | null;
}
