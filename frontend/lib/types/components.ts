// ---------------------------------------------------------------------------
// Component types — frontend-only types for React component props and state.
// ---------------------------------------------------------------------------

import type { RuntimeResponse, StepEvent } from "./api";

export type ErrorCode = "stream_error" | "timeout" | "rate_limit" | "generic";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: RuntimeResponse;
  loading?: boolean;
  timestamp: number;
  steps?: StepEvent[];
  errorCode?: ErrorCode;
}
