/**
 * ResultPanelHelpers — pointAreaI18n + buildAreasI18n coverage.
 *
 * Covers:
 * - pointAreaI18n with a point inside a known area → returns area name
 * - pointAreaI18n with a point outside all areas → returns otherLabel
 * - buildAreasI18n with mixed points (some inside, some outside)
 */

import { describe, it, expect } from "vitest";
import {
  pointAreaI18n,
  buildAreasI18n,
} from "@/components/layout/ResultPanelHelpers";
import type { PilgrimagePoint } from "@/lib/types";

function makePoint(lat: number, lng: number): PilgrimagePoint {
  return {
    id: "pt-test",
    name: "Test Point",
    name_cn: null,
    episode: null,
    time_seconds: null,
    screenshot_url: null,
    bangumi_id: null,
    latitude: lat,
    longitude: lng,
  };
}

describe("pointAreaI18n", () => {
  it("returns area name when point is inside a known area (宇治)", () => {
    // Center of 宇治: lat 34.888, lng 135.802, radius 4km
    const point = makePoint(34.888, 135.802);
    expect(pointAreaI18n(point, "その他")).toBe("宇治");
  });

  it("returns area name for 京都市", () => {
    const point = makePoint(34.985, 135.758);
    expect(pointAreaI18n(point, "その他")).toBe("京都市");
  });

  it("returns otherLabel when point is outside all known areas", () => {
    // Tokyo (far from any Kansai area)
    const point = makePoint(35.68, 139.76);
    expect(pointAreaI18n(point, "その他")).toBe("その他");
  });

  it("matches the first area in KNOWN_AREAS order when overlapping", () => {
    // 宇治 is checked before 京都市, and 宇治 center is within 京都市 radius
    const point = makePoint(34.888, 135.802);
    const result = pointAreaI18n(point, "Other");
    // Should match 宇治 first since it's earlier in the list
    expect(result).toBe("宇治");
  });
});

describe("buildAreasI18n", () => {
  it("returns sorted unique area labels for points in known areas", () => {
    const points = [
      makePoint(34.888, 135.802), // 宇治
      makePoint(34.985, 135.758), // 京都市
      makePoint(34.889, 135.803), // also 宇治 (deduplicated)
    ];
    const areas = buildAreasI18n(points, "その他");
    expect(areas).toEqual(["京都市", "宇治"]);
  });

  it("includes otherLabel for points outside all known areas", () => {
    const points = [
      makePoint(34.888, 135.802), // 宇治
      makePoint(35.68, 139.76),   // Tokyo → その他
    ];
    const areas = buildAreasI18n(points, "その他");
    expect(areas).toContain("宇治");
    expect(areas).toContain("その他");
  });

  it("returns only otherLabel when no points match any area", () => {
    const points = [
      makePoint(35.68, 139.76),   // Tokyo
      makePoint(43.06, 141.35),   // Sapporo
    ];
    const areas = buildAreasI18n(points, "Other");
    expect(areas).toEqual(["Other"]);
  });

  it("returns empty for no points", () => {
    const areas = buildAreasI18n([], "その他");
    expect(areas).toEqual([]);
  });

  it("handles mixed points with multiple known areas and other", () => {
    const points = [
      makePoint(34.888, 135.802), // 宇治
      makePoint(34.686, 135.520), // 大阪
      makePoint(35.68, 139.76),   // → その他
      makePoint(34.690, 135.195), // 神戸
    ];
    const areas = buildAreasI18n(points, "その他");
    expect(areas).toEqual(["その他", "大阪", "宇治", "神戸"]);
  });
});
