/** The public contract validates chunks from the actual native view projection. */
import { describe, expect, it } from "vitest";
import { ChatResponseDataPart } from "../src/chat-data-parts.js";
import { responseChunks, SAFE_FAILURE } from "../../../workers/edge/src/agent/views/public-content.ts";
import { SecretScrub } from "../../../workers/edge/src/agent/egress/secret-scrub.ts";

const MESSAGE = "A pilgrimage answer";
const POINT = { id: "spot-1", name: "鷲宮神社", latitude: 36.1019, longitude: 139.6586 };
const ITINERARY = { ordered_points: [POINT], point_count: 1 };
const ANSWERS = [
  { intent: "search_bangumi", data: { results: { rows: [POINT], kind: "bangumi" } } },
  { intent: "search_nearby", data: { results: { rows: [], kind: "nearby" } } },
  { intent: "plan_route", data: { itinerary: ITINERARY } },
  { intent: "plan_selected", data: { itinerary: ITINERARY } },
  { intent: "plan_multi", data: { results: { rows: [POINT] }, itinerary: ITINERARY } },
  { intent: "clarify", data: { clarification_id: 3, reason: "anime_ambiguity", candidates: [{ id: "1", title: "らき☆すた" }] } },
  { intent: "general_qa", data: {} },
  { intent: "greet_user", data: {} },
  { intent: "blocked", data: {}, status: "invalid_request", success: false },
];

function projected(details: unknown) {
  const chunk = responseChunks(details, "session-1", new SecretScrub()).at(-1);
  expect(chunk?.type).toBe("data-response");
  if (!chunk || !("data" in chunk)) throw new Error("Missing native response chunk");
  return ChatResponseDataPart.parse(chunk.data);
}

describe("native response projection", () => {
  it.each(ANSWERS)("publishes the declared domain result for $intent", (answer) => {
    const result = projected({ ...answer, message: MESSAGE });
    expect(result.intent).toBe(answer.intent);
    expect(result.message).toBe(MESSAGE);
    expect(result.session_id).toBe("session-1");
  });

  it("retains both halves of a multi selection", () => {
    const result = projected({ ...ANSWERS[4], message: MESSAGE });
    expect(result.data).toEqual({ results: { rows: [POINT] }, itinerary: ITINERARY });
  });

  it("keeps the native clarification identity and candidate data", () => {
    expect(projected(ANSWERS[5]).data).toEqual(ANSWERS[5]?.data);
  });

  it("keeps a refusal's status and success false", () => {
    expect(projected(ANSWERS[8])).toMatchObject({ status: "invalid_request", success: false });
  });

  it("does not expose native execution or context annotations", () => {
    const result = projected({ intent: "greet_user", message: MESSAGE, data: {},
      execution: { operationId: "op", toolCallId: "call", args: { secret: "hidden" } },
      frozenSummary: "private", executedFacts: { pacing: "slow" } });
    expect(result).toEqual({ intent: "greet_user", message: MESSAGE, data: {}, session_id: "session-1" });
  });

  it("fails closed on unknown domain data instead of publishing an invalid result", () => {
    expect(responseChunks({ intent: "greet_user", data: { invented: true } }, "session-1", new SecretScrub()))
      .toEqual([{ type: "error", errorText: SAFE_FAILURE }]);
  });
});
