import type { RuntimeResponse } from "@/lib/types";

/** Successful search response with one result point. */
export const SEARCH_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "search_bangumi",
  session_id: "test-session-001",
  message: "Found 1 pilgrimage spot for Liz and the Blue Bird.",
  data: {
    results: {
      rows: [
        {
          id: "pt-001",
          name: "宇治駅",
          name_cn: "宇治站",
          episode: 1,
          time_seconds: 120,
          screenshot_url: "https://example.com/screenshot.jpg",
          bangumi_id: "bg-001",
          latitude: 34.8841,
          longitude: 135.8007,
        },
      ],
      row_count: 1,
      strategy: "sql",
      status: "ok",
    },
    message: "Found 1 pilgrimage spot for Liz and the Blue Bird.",
    status: "ok",
  },
  session: {
    interaction_count: 1,
    route_history_count: 0,
  },
  route_history: [],
  errors: [],
};

/** Empty search response (no results found). */
export const EMPTY_SEARCH_RESPONSE: RuntimeResponse = {
  success: true,
  status: "empty",
  intent: "search_bangumi",
  session_id: "test-session-002",
  message: "No pilgrimage spots found.",
  data: {
    results: {
      rows: [],
      row_count: 0,
      strategy: "sql",
      status: "empty",
    },
    message: "No pilgrimage spots found.",
    status: "empty",
  },
  session: {
    interaction_count: 1,
    route_history_count: 0,
  },
  route_history: [],
  errors: [],
};

/** Error response from the backend. */
export const ERROR_RESPONSE: RuntimeResponse = {
  success: false,
  status: "error",
  intent: "search_bangumi",
  session_id: null,
  message: "An internal error occurred.",
  data: {
    results: {
      rows: [],
      row_count: 0,
      strategy: "sql",
      status: "empty",
    },
    message: "An internal error occurred.",
    status: "empty",
  },
  session: {
    interaction_count: 0,
    route_history_count: 0,
  },
  route_history: [],
  errors: [
    {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
      details: {},
    },
  ],
};

/** Conversations list response. */
export const CONVERSATIONS_RESPONSE: { conversations: unknown[] } = {
  conversations: [],
};

/** Route history response. */
export const ROUTES_RESPONSE: { routes: unknown[] } = {
  routes: [],
};

/** Feedback submission response. */
export const FEEDBACK_RESPONSE: { feedback_id: string } = {
  feedback_id: "fb-001",
};
