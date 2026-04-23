// ---------------------------------------------------------------------------
// Response objects — search, clarify, nearby, greet.
// ---------------------------------------------------------------------------

import type { RuntimeResponse } from "@/lib/types";
import type { ClarifyCandidate } from "@/lib/types/domain";
import { EUPHONIUM_POINTS, NEARBY_POINTS } from "./points";
import { SESSION_ID, baseSession } from "./helpers";

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
