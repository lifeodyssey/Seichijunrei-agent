// ---------------------------------------------------------------------------
// Mock data layer — RuntimeResponse objects for demo / offline mode.
// Uses real Anitabi image URLs and Japanese location names.
// ---------------------------------------------------------------------------

import type { RuntimeResponse } from "@/lib/types";
import type {
  PilgrimagePoint,
  TimedStop,
  TransitLeg,
  ClarifyCandidate,
} from "@/lib/types/domain";

// ── Anime cover URLs keyed by bangumi_id ──────────────────────────────────

export const ANIME_COVERS: Record<string, string> = {
  "115908": "https://image.anitabi.cn/bangumi/115908.jpg?plan=h160",
  "160209": "https://image.anitabi.cn/bangumi/160209.jpg?plan=h160",
  "269235": "https://image.anitabi.cn/bangumi/269235.jpg?plan=h160",
  "485": "https://image.anitabi.cn/bangumi/485.jpg",
  "1424": "https://image.anitabi.cn/bangumi/1424.jpg",
  "362577": "https://image.anitabi.cn/bangumi/362577.jpg",
  "55113": "https://image.anitabi.cn/bangumi/55113.jpg",
  "27364": "https://image.anitabi.cn/bangumi/27364.jpg",
};

// ── Shared helpers ────────────────────────────────────────────────────────

const SESSION_ID = "mock-session-001";

function baseSession(interactionCount: number) {
  return {
    interaction_count: interactionCount,
    route_history_count: 0,
    last_intent: null,
    last_status: null,
    last_message: "",
  };
}

// ── Euphonium pilgrimage points (Uji, Kyoto) ─────────────────────────────

const EUPHONIUM_POINTS: PilgrimagePoint[] = [
  {
    id: "pt-eu-001",
    name: "京都コンサートホール",
    name_cn: "京都音乐厅",
    episode: 1,
    time_seconds: 85,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/qys7fu.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8892,
    longitude: 135.7983,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-002",
    name: "あじろぎの道",
    name_cn: "网代木之道",
    episode: 1,
    time_seconds: 210,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7evkbmy2.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8873,
    longitude: 135.8072,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-003",
    name: "莵道高",
    name_cn: "莵道高中",
    episode: 1,
    time_seconds: 340,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7eyih3xg.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8901,
    longitude: 135.8055,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-004",
    name: "宇治橋",
    name_cn: "宇治桥",
    episode: 2,
    time_seconds: 125,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/qys7fu.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8847,
    longitude: 135.8008,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-005",
    name: "中書島駅",
    name_cn: "中书岛站",
    episode: 3,
    time_seconds: 60,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7evkbmy2.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.9032,
    longitude: 135.7642,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-006",
    name: "平等院表参道",
    name_cn: "平等院表参道",
    episode: 3,
    time_seconds: 430,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7eyih3xg.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8856,
    longitude: 135.8044,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-007",
    name: "宇治駅前商店街",
    name_cn: "宇治站前商店街",
    episode: 4,
    time_seconds: 180,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/qys7fu.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8841,
    longitude: 135.8007,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-008",
    name: "朝霧橋",
    name_cn: "朝雾桥",
    episode: 5,
    time_seconds: 290,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7evkbmy2.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8868,
    longitude: 135.8092,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-009",
    name: "興聖寺",
    name_cn: "兴圣寺",
    episode: 6,
    time_seconds: 155,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7eyih3xg.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8882,
    longitude: 135.8101,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-010",
    name: "京阪宇治駅",
    name_cn: "京阪宇治站",
    episode: 7,
    time_seconds: 400,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/qys7fu.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8835,
    longitude: 135.8063,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-011",
    name: "県神社",
    name_cn: "县神社",
    episode: 8,
    time_seconds: 78,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7evkbmy2.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8859,
    longitude: 135.8038,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
  {
    id: "pt-eu-012",
    name: "大吉山展望台",
    name_cn: "大吉山展望台",
    episode: 8,
    time_seconds: 520,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7eyih3xg.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8915,
    longitude: 135.8110,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
  },
];

// ── MOCK_SEARCH_RESPONSE (intent: search_bangumi) ─────────────────────────

export const MOCK_SEARCH_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "search_bangumi",
  session_id: SESSION_ID,
  message:
    "找到了「響け！ユーフォニアム」的 156 个取景地，主要分布在宇治市和京都市区。",
  data: {
    results: {
      rows: EUPHONIUM_POINTS,
      row_count: 12,
      strategy: "sql",
      status: "ok",
    },
    message:
      "找到了「響け！ユーフォニアム」的 156 个取景地，主要分布在宇治市和京都市区。",
    status: "ok",
  },
  session: baseSession(1),
  route_history: [],
  errors: [],
};

// ── MOCK_ROUTE_RESPONSE (intent: plan_route) ──────────────────────────────

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

export const MOCK_ROUTE_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "plan_route",
  session_id: SESSION_ID,
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

// ── MOCK_CLARIFY_RESPONSE (intent: clarify) ───────────────────────────────

const CLARIFY_CANDIDATES: ClarifyCandidate[] = [
  {
    title: "涼宮ハルヒの憂鬱",
    cover_url: "https://image.anitabi.cn/bangumi/485.jpg",
    spot_count: 134,
    city: "西宮市",
  },
  {
    title: "涼宮ハルヒの消失",
    cover_url: null,
    spot_count: 42,
    city: "西宮市",
  },
];

export const MOCK_CLARIFY_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "clarify",
  session_id: SESSION_ID,
  message: "找到了多部相关作品，请确认你想查找哪一部。",
  data: {
    intent: "clarify",
    confidence: 0.85,
    status: "needs_clarification",
    message: "找到了多部相关作品，请确认你想查找哪一部。",
    question: "どちらの作品ですか？",
    options: ["涼宮ハルヒの憂鬱", "涼宮ハルヒの消失"],
    candidates: CLARIFY_CANDIDATES,
  },
  session: baseSession(1),
  route_history: [],
  errors: [],
};

// ── MOCK_NEARBY_RESPONSE (intent: search_nearby) ─────────────────────────

const NEARBY_POINTS: PilgrimagePoint[] = [
  {
    id: "pt-nb-001",
    name: "宇治橋",
    name_cn: "宇治桥",
    episode: 2,
    time_seconds: 125,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/qys7fu.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8847,
    longitude: 135.8008,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
    distance_m: 120,
  },
  {
    id: "pt-nb-002",
    name: "宇治駅前商店街",
    name_cn: "宇治站前商店街",
    episode: 4,
    time_seconds: 180,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7evkbmy2.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8841,
    longitude: 135.8007,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
    distance_m: 150,
  },
  {
    id: "pt-nb-003",
    name: "平等院表参道",
    name_cn: "平等院表参道",
    episode: 3,
    time_seconds: 430,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/7eyih3xg.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8856,
    longitude: 135.8044,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
    distance_m: 310,
  },
  {
    id: "pt-nb-004",
    name: "県神社",
    name_cn: "县神社",
    episode: 8,
    time_seconds: 78,
    screenshot_url:
      "https://image.anitabi.cn/points/115908/qys7fu.jpg?plan=h160",
    bangumi_id: "115908",
    latitude: 34.8859,
    longitude: 135.8038,
    title: "響け！ユーフォニアム",
    title_cn: "吹响！上低音号",
    distance_m: 420,
  },
  {
    id: "pt-nb-005",
    name: "旧豊郷小学校",
    name_cn: "旧丰乡小学",
    episode: 1,
    time_seconds: 95,
    screenshot_url: null,
    bangumi_id: "1424",
    latitude: 34.8860,
    longitude: 135.8020,
    title: "けいおん！",
    title_cn: "轻音少女",
    distance_m: 480,
  },
  {
    id: "pt-nb-006",
    name: "修学院駅前",
    name_cn: "修学院站前",
    episode: 3,
    time_seconds: 200,
    screenshot_url: null,
    bangumi_id: "1424",
    latitude: 34.8875,
    longitude: 135.8015,
    title: "けいおん！",
    title_cn: "轻音少女",
    distance_m: 620,
  },
  {
    id: "pt-nb-007",
    name: "北白川バス停",
    name_cn: "北白川巴士站",
    episode: 5,
    time_seconds: 310,
    screenshot_url: null,
    bangumi_id: "1424",
    latitude: 34.8890,
    longitude: 135.7995,
    title: "けいおん！",
    title_cn: "轻音少女",
    distance_m: 750,
  },
  {
    id: "pt-nb-008",
    name: "出町桝形商店街",
    name_cn: "出町桝形商店街",
    episode: 1,
    time_seconds: 140,
    screenshot_url: null,
    bangumi_id: "55113",
    latitude: 34.8852,
    longitude: 135.7960,
    title: "たまこまーけっと",
    title_cn: "玉子市场",
    distance_m: 890,
  },
];

export const MOCK_NEARBY_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "search_nearby",
  session_id: SESSION_ID,
  message: "在宇治市 1km 范围内找到了 8 个动漫取景地。",
  data: {
    results: {
      rows: NEARBY_POINTS,
      row_count: 8,
      strategy: "geo",
      status: "ok",
    },
    message: "在宇治市 1km 范围内找到了 8 个动漫取景地。",
    status: "ok",
  },
  session: baseSession(1),
  route_history: [],
  errors: [],
};

// ── MOCK_GREET_RESPONSE (intent: greet_user) ──────────────────────────────

export const MOCK_GREET_RESPONSE: RuntimeResponse = {
  success: true,
  status: "ok",
  intent: "greet_user",
  session_id: SESSION_ID,
  message:
    "你好！我可以帮你搜索动漫圣地、规划巡礼路线，或者查找你附近的取景地。想去哪里？",
  data: {
    intent: "greet_user",
    confidence: 1.0,
    status: "info",
    message:
      "你好！我可以帮你搜索动漫圣地、规划巡礼路线，或者查找你附近的取景地。想去哪里？",
  },
  session: baseSession(0),
  route_history: [],
  errors: [],
};
