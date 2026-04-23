// ---------------------------------------------------------------------------
// Route / timeline mock data — stops, legs, and the route response.
// ---------------------------------------------------------------------------

import type { RuntimeResponse } from "@/lib/types";
import type { TimedStop, TransitLeg } from "@/lib/types/domain";
import { EUPHONIUM_POINTS } from "./points";
import { baseSession } from "./helpers";

// ── Route stops ───────────────────────────────────────────────────────────

const ROUTE_STOPS: TimedStop[] = [
  {
    cluster_id: "cl-001",
    name: "宇治駅",
    arrive: "09:00",
    depart: "09:45",
    dwell_minutes: 45,
    lat: 34.8841,
    lng: 135.8007,
    photo_count: 3,
    points: EUPHONIUM_POINTS.slice(0, 3),
  },
  {
    cluster_id: "cl-002",
    name: "あじろぎの道",
    arrive: "09:55",
    depart: "10:30",
    dwell_minutes: 35,
    lat: 34.8873,
    lng: 135.8072,
    photo_count: 7,
    points: EUPHONIUM_POINTS.slice(3, 10),
  },
  {
    cluster_id: "cl-003",
    name: "平等院表参道",
    arrive: "10:38",
    depart: "11:08",
    dwell_minutes: 30,
    lat: 34.8856,
    lng: 135.8044,
    photo_count: 4,
    points: EUPHONIUM_POINTS.slice(4, 8),
  },
  {
    cluster_id: "cl-004",
    name: "興聖寺",
    arrive: "11:13",
    depart: "11:38",
    dwell_minutes: 25,
    lat: 34.8882,
    lng: 135.8101,
    photo_count: 2,
    points: EUPHONIUM_POINTS.slice(8, 10),
  },
  {
    cluster_id: "cl-005",
    name: "京阪宇治駅",
    arrive: "11:50",
    depart: "12:05",
    dwell_minutes: 15,
    lat: 34.8835,
    lng: 135.8063,
    photo_count: 1,
    points: [EUPHONIUM_POINTS[9]],
  },
];

// ── Route transit legs ────────────────────────────────────────────────────

const ROUTE_LEGS: TransitLeg[] = [
  {
    from_id: "cl-001",
    to_id: "cl-002",
    mode: "walk",
    duration_minutes: 10,
    distance_m: 650,
  },
  {
    from_id: "cl-002",
    to_id: "cl-003",
    mode: "walk",
    duration_minutes: 8,
    distance_m: 480,
  },
  {
    from_id: "cl-003",
    to_id: "cl-004",
    mode: "walk",
    duration_minutes: 5,
    distance_m: 320,
  },
  {
    from_id: "cl-004",
    to_id: "cl-005",
    mode: "walk",
    duration_minutes: 12,
    distance_m: 650,
  },
];

// ── MOCK_ROUTE_RESPONSE (intent: plan_route) ──────────────────────────────

export const MOCK_ROUTE_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "plan_route",
  session_id: "mock-session-001",
  message: "已为你规划好宇治巡礼路线，全程约 2.1km 步行，预计 2 小时 15 分钟。",
  data: {
    results: {
      rows: EUPHONIUM_POINTS.slice(0, 5),
      row_count: 5,
      strategy: "sql",
      status: "ok",
    },
    route: {
      ordered_points: EUPHONIUM_POINTS.slice(0, 5),
      point_count: 5,
      status: "ok",
      summary: {
        point_count: 5,
        with_coordinates: 5,
        without_coordinates: 0,
      },
      timed_itinerary: {
        stops: ROUTE_STOPS,
        legs: ROUTE_LEGS,
        total_minutes: 135,
        total_distance_m: 2100,
        spot_count: 17,
        pacing: "normal",
        start_time: "09:00",
        export_google_maps_url: [
          "https://www.google.com/maps/dir/34.8841,135.8007/34.8873,135.8072/34.8856,135.8044/34.8882,135.8101/34.8835,135.8063",
        ],
        export_ics: [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Seichijunrei//Route//EN",
          "BEGIN:VEVENT",
          "DTSTART:20260501T090000",
          "DTEND:20260501T120500",
          "SUMMARY:宇治 ユーフォニアム巡礼",
          "DESCRIPTION:宇治駅→あじろぎの道→平等院表参道→興聖寺→京阪宇治駅",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
      },
    },
    message:
      "已为你规划好宇治巡礼路线，全程约 2.1km 步行，预计 2 小时 15 分钟。",
    status: "ok",
  },
  session: baseSession(2),
  route_history: [
    {
      route_id: "route-mock-001",
      bangumi_id: "115908",
      origin_station: "宇治駅",
      point_count: 5,
      status: "ok",
      created_at: "2026-04-21T09:00:00Z",
    },
  ],
  errors: [],
};
