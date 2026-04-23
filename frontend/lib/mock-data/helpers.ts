// ---------------------------------------------------------------------------
// Shared helpers for mock-data modules.
// ---------------------------------------------------------------------------

export const SESSION_ID = "mock-session-001";

export function baseSession(interactionCount: number) {
  return {
    interaction_count: interactionCount,
    route_history_count: 0,
    last_intent: null,
    last_status: null,
    last_message: "",
  };
}
