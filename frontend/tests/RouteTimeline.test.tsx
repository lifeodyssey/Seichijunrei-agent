/**
 * RouteTimeline unit tests (TDD).
 *
 * AC coverage:
 * - Renders a numbered stop entry for each stop in the itinerary -> unit
 * - Shows arrival time and dwell duration per stop -> unit
 * - Renders a transit leg connector between consecutive stops -> unit
 * - Renders summary stats (spot_count, total_minutes, total_distance_m) -> unit
 * - No transit connector shown after the last stop -> unit
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RouteTimeline from "@/components/generative/RouteTimeline";
import type { TimedItinerary, TimedStop, TransitLeg } from "@/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStop(overrides: Partial<TimedStop> = {}): TimedStop {
  return {
    cluster_id: "c-001",
    name: "宇治駅",
    arrive: "09:00",
    depart: "09:45",
    dwell_minutes: 45,
    lat: 34.88,
    lng: 135.8,
    photo_count: 3,
    points: [],
    ...overrides,
  };
}

function makeLeg(overrides: Partial<TransitLeg> = {}): TransitLeg {
  return {
    from_id: "c-001",
    to_id: "c-002",
    mode: "walk",
    duration_minutes: 10,
    distance_m: 700,
    ...overrides,
  };
}

function makeItinerary(overrides: Partial<TimedItinerary> = {}): TimedItinerary {
  const stop1 = makeStop({ cluster_id: "c-001", name: "宇治駅", arrive: "09:00" });
  const stop2 = makeStop({ cluster_id: "c-002", name: "平等院", arrive: "09:55" });
  return {
    stops: [stop1, stop2],
    legs: [makeLeg({ from_id: "c-001", to_id: "c-002" })],
    total_minutes: 120,
    total_distance_m: 1400,
    spot_count: 2,
    pacing: "normal",
    start_time: "09:00",
    export_google_maps_url: [],
    export_ics: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RouteTimeline", () => {
  describe("stop rendering", () => {
    it("renders a numbered entry for each stop", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      expect(screen.getByText("宇治駅")).toBeInTheDocument();
      expect(screen.getByText("平等院")).toBeInTheDocument();
    });

    it("shows sequential stop numbers", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      // Both "1" and "2" appear as numbered badges.
      expect(screen.getAllByText("1").length).toBeGreaterThan(0);
      expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    });

    it("shows arrival time for each stop", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      expect(screen.getByText("09:00")).toBeInTheDocument();
      expect(screen.getByText("09:55")).toBeInTheDocument();
    });

    it("shows dwell duration for each stop", () => {
      const itinerary = makeItinerary({
        stops: [makeStop({ cluster_id: "c-001", dwell_minutes: 30 })],
        legs: [],
      });
      render(<RouteTimeline itinerary={itinerary} />);
      expect(screen.getByText(/30min/)).toBeInTheDocument();
    });

    it("shows photo count for each stop", () => {
      const itinerary = makeItinerary({
        stops: [makeStop({ cluster_id: "c-001", photo_count: 7 })],
        legs: [],
      });
      render(<RouteTimeline itinerary={itinerary} />);
      expect(screen.getByText(/7 scenes/)).toBeInTheDocument();
    });
  });

  describe("transit leg rendering", () => {
    it("renders a transit leg connector between two consecutive stops", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      expect(screen.getByText(/10min/)).toBeInTheDocument();
    });

    it("does not render a transit connector after the last stop", () => {
      const itinerary = makeItinerary({
        stops: [makeStop({ cluster_id: "c-001" })],
        legs: [],
      });
      render(<RouteTimeline itinerary={itinerary} />);
      // Transit leg connector uses "🚶 Nmin" — should not appear with one stop.
      expect(screen.queryByText(/🚶/)).toBeNull();
    });
  });

  describe("summary section", () => {
    it("shows total spot count", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      // spot_count is 2 — appears in summary dl
      const cells = screen.getAllByText("2");
      expect(cells.length).toBeGreaterThan(0);
    });

    it("shows total duration in minutes", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      expect(screen.getByText("120min")).toBeInTheDocument();
    });

    it("shows total distance formatted as km", () => {
      render(<RouteTimeline itinerary={makeItinerary()} />);
      expect(screen.getByText("1.4 km")).toBeInTheDocument();
    });
  });
});
