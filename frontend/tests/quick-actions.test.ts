/**
 * Tests for lib/quick-actions.ts (Issue #148)
 *
 * AC coverage:
 * - QUICK_ACTION_QUERIES exported from shared file -> unit
 * - All three locales (ja/zh/en) have exactly 3 entries -> unit
 * - getQuickActionQuery returns correct query per locale and index -> unit
 */

import { describe, it, expect } from "vitest";
import { QUICK_ACTION_QUERIES, getQuickActionQuery } from "@/lib/quick-actions";

describe("QUICK_ACTION_QUERIES", () => {
  it("exports QUICK_ACTION_QUERIES with ja, zh, en keys", () => {
    expect(QUICK_ACTION_QUERIES).toHaveProperty("ja");
    expect(QUICK_ACTION_QUERIES).toHaveProperty("zh");
    expect(QUICK_ACTION_QUERIES).toHaveProperty("en");
  });

  it("each locale has exactly 3 query strings", () => {
    expect(QUICK_ACTION_QUERIES.ja).toHaveLength(3);
    expect(QUICK_ACTION_QUERIES.zh).toHaveLength(3);
    expect(QUICK_ACTION_QUERIES.en).toHaveLength(3);
  });

  it("ja queries are in Japanese", () => {
    expect(QUICK_ACTION_QUERIES.ja[0]).toContain("聖地");
    expect(QUICK_ACTION_QUERIES.ja[1]).toContain("聖地");
    expect(QUICK_ACTION_QUERIES.ja[2]).toContain("ルート");
  });

  it("zh queries are in Chinese", () => {
    expect(QUICK_ACTION_QUERIES.zh[0]).toMatch(/取景地|圣地/);
    expect(QUICK_ACTION_QUERIES.zh[1]).toMatch(/取景地|圣地/);
    expect(QUICK_ACTION_QUERIES.zh[2]).toMatch(/路线|巡礼/);
  });

  it("en queries are in English", () => {
    expect(QUICK_ACTION_QUERIES.en[0]).toMatch(/anime|spots/i);
    expect(QUICK_ACTION_QUERIES.en[1]).toMatch(/anime|spots/i);
    expect(QUICK_ACTION_QUERIES.en[2]).toMatch(/route|pilgrimage/i);
  });
});

describe("getQuickActionQuery", () => {
  it("returns correct query for ja locale index 0", () => {
    expect(getQuickActionQuery("ja", 0)).toBe(QUICK_ACTION_QUERIES.ja[0]);
  });

  it("returns correct query for zh locale index 1", () => {
    expect(getQuickActionQuery("zh", 1)).toBe(QUICK_ACTION_QUERIES.zh[1]);
  });

  it("returns correct query for en locale index 2", () => {
    expect(getQuickActionQuery("en", 2)).toBe(QUICK_ACTION_QUERIES.en[2]);
  });
});
