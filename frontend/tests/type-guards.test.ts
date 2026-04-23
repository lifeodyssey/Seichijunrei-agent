import { it, expect } from "vitest";

import { isSearchData, isRouteData, isQAData, isTimedRouteData } from "../lib/types";

// AC: isSearchData(null) returns false
it("isSearchData returns false for null", () => {
  expect(isSearchData(null as never)).toBe(false);
});

// AC: isRouteData(undefined) returns false
it("isRouteData returns false for undefined", () => {
  expect(isRouteData(undefined as never)).toBe(false);
});

it("isQAData returns false for null", () => {
  expect(isQAData(null as never)).toBe(false);
});

it("isTimedRouteData returns false for null", () => {
  expect(isTimedRouteData(null as never)).toBe(false);
});

it("isSearchData returns true for valid search data", () => {
  const data = {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    message: "Found 0 results",
    status: "ok",
  };
  expect(isSearchData(data as never)).toBe(true);
});

it("isRouteData returns true for valid route data", () => {
  const data = {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    route: { ordered_points: [], point_count: 0, status: "ok" },
    message: "Route planned",
    status: "ok",
  };
  expect(isRouteData(data as never)).toBe(true);
});

it("isSearchData returns false for route data (has route key)", () => {
  const data = {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    route: { ordered_points: [], point_count: 0, status: "ok" },
    message: "Route planned",
    status: "ok",
  };
  expect(isSearchData(data as never)).toBe(false);
});

it("isQAData returns true for info status", () => {
  const data = {
    intent: "general_qa",
    confidence: 0.9,
    status: "info",
    message: "Hello!",
  };
  expect(isQAData(data as never)).toBe(true);
});

it("isTimedRouteData returns false when route is null", () => {
  expect(isTimedRouteData({ route: null } as never)).toBe(false);
});

it("isTimedRouteData returns false when route is undefined", () => {
  expect(isTimedRouteData({ route: undefined } as never)).toBe(false);
});

it("isTimedRouteData returns true for route with timed_itinerary", () => {
  const data = {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    route: {
      ordered_points: [],
      point_count: 0,
      status: "ok",
      timed_itinerary: {
        stops: [],
        legs: [],
        total_minutes: 0,
        total_distance_m: 0,
        spot_count: 0,
        pacing: "normal",
        start_time: "09:00",
        export_google_maps_url: [],
        export_ics: "",
      },
    },
    message: "Timed route",
    status: "ok",
  };
  expect(isTimedRouteData(data as never)).toBe(true);
});
