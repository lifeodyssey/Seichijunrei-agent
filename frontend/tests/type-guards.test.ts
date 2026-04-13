import assert from "node:assert/strict";
import test from "node:test";

import { isSearchData, isRouteData, isQAData, isTimedRouteData } from "../lib/types";

// AC: isSearchData(null) returns false
test("isSearchData returns false for null", () => {
  assert.equal(isSearchData(null as never), false);
});

// AC: isRouteData(undefined) returns false
test("isRouteData returns false for undefined", () => {
  assert.equal(isRouteData(undefined as never), false);
});

test("isQAData returns false for null", () => {
  assert.equal(isQAData(null as never), false);
});

test("isTimedRouteData returns false for null", () => {
  assert.equal(isTimedRouteData(null as never), false);
});

test("isSearchData returns true for valid search data", () => {
  const data = {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    message: "Found 0 results",
    status: "ok",
  };
  assert.equal(isSearchData(data as never), true);
});

test("isRouteData returns true for valid route data", () => {
  const data = {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    route: { ordered_points: [], point_count: 0, status: "ok" },
    message: "Route planned",
    status: "ok",
  };
  assert.equal(isRouteData(data as never), true);
});

test("isSearchData returns false for route data (has route key)", () => {
  const data = {
    results: { rows: [], row_count: 0, strategy: "sql", status: "ok" },
    route: { ordered_points: [], point_count: 0, status: "ok" },
    message: "Route planned",
    status: "ok",
  };
  assert.equal(isSearchData(data as never), false);
});

test("isQAData returns true for info status", () => {
  const data = {
    intent: "general_qa",
    confidence: 0.9,
    status: "info",
    message: "Hello!",
  };
  assert.equal(isQAData(data as never), true);
});

test("isTimedRouteData returns true for route with timed_itinerary", () => {
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
  assert.equal(isTimedRouteData(data as never), true);
});
