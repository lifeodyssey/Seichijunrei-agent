/**
 * AC: api barrel exports resolve — all existing imports work unchanged after split.
 * AC: No runtime behavior changes after api.ts split.
 */
import { describe, it, expect } from "vitest";

describe("api module barrel exports", () => {
  it("exports sendMessage", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.sendMessage).toBe("function");
  });

  it("exports sendSelectedRoute", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.sendSelectedRoute).toBe("function");
  });

  it("exports sendMessageStream", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.sendMessageStream).toBe("function");
  });

  it("exports submitFeedback", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.submitFeedback).toBe("function");
  });

  it("exports fetchConversations", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.fetchConversations).toBe("function");
  });

  it("exports fetchConversationMessages", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.fetchConversationMessages).toBe("function");
  });

  it("exports patchConversationTitle", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.patchConversationTitle).toBe("function");
  });

  it("exports fetchRouteHistory", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.fetchRouteHistory).toBe("function");
  });

  it("exports buildSelectedRouteActionText", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.buildSelectedRouteActionText).toBe("function");
  });

  it("exports hydrateResponseData", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.hydrateResponseData).toBe("function");
  });

  it("exports fetchPopularBangumi", async () => {
    const mod = await import("@/lib/api");
    expect(typeof mod.fetchPopularBangumi).toBe("function");
  });

  it("buildSelectedRouteActionText returns correct ja text", async () => {
    const { buildSelectedRouteActionText } = await import("@/lib/api");
    const result = buildSelectedRouteActionText(3, "宇治駅", "ja");
    expect(result).toBe("宇治駅から選択した3件のスポットでルートを作成して。");
  });

  it("buildSelectedRouteActionText returns correct en text without origin", async () => {
    const { buildSelectedRouteActionText } = await import("@/lib/api");
    const result = buildSelectedRouteActionText(2, null, "en");
    expect(result).toBe("Create a route with 2 selected stops.");
  });

  it("hydrateResponseData returns undefined for null", async () => {
    const { hydrateResponseData } = await import("@/lib/api");
    expect(hydrateResponseData(null)).toBeUndefined();
  });

  it("hydrateResponseData passes through object with data key", async () => {
    const { hydrateResponseData } = await import("@/lib/api");
    const input = { data: { results: [] }, intent: "search_bangumi" };
    expect(hydrateResponseData(input)).toEqual(input);
  });

  it("hydrateResponseData converts final_output to data key", async () => {
    const { hydrateResponseData } = await import("@/lib/api");
    const finalOutput = { results: [], message: "ok" };
    const input = { intent: "search_bangumi", final_output: finalOutput };
    const result = hydrateResponseData(input);
    expect(result).toEqual({ intent: "search_bangumi", final_output: finalOutput, data: finalOutput });
  });
});
