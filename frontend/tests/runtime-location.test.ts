/**
 * AC: After geolocation acquired, next route request includes origin_lat/origin_lng in API payload -> unit
 */
import { describe, it, expect, vi } from "vitest";
import { sendMessage } from "@/lib/api/runtime";

describe("sendMessage with geolocation coords", () => {
  it("includes origin_lat and origin_lng in request body when provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      async (input, init) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            success: true,
            status: "ok",
            intent: "search_nearby",
            session_id: null,
            message: "ok",
            data: {},
            session: { interaction_count: 1, route_history_count: 0 },
            route_history: [],
            errors: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    await sendMessage("近くの聖地", null, "ja", undefined, {
      origin_lat: 35.0,
      origin_lng: 135.0,
    });

    expect(capturedBody.origin_lat).toBe(35.0);
    expect(capturedBody.origin_lng).toBe(135.0);

    fetchSpy.mockRestore();
  });

  it("does not include origin_lat/origin_lng when not provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      async (_input, init) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            success: true,
            status: "ok",
            intent: "search_bangumi",
            session_id: null,
            message: "ok",
            data: {},
            session: { interaction_count: 1, route_history_count: 0 },
            route_history: [],
            errors: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    await sendMessage("君の名は の聖地");

    expect(capturedBody.origin_lat).toBeUndefined();
    expect(capturedBody.origin_lng).toBeUndefined();

    fetchSpy.mockRestore();
  });
});
