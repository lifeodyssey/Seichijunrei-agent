import type {
  PilgrimagePoint,
  RouteData,
  RouteHistoryRecord,
  SearchResultData,
} from "./types";

function createPoster(
  title: string,
  subtitle: string,
  accent: string,
  glow: string,
) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${accent}" />
          <stop offset="100%" stop-color="#101725" />
        </linearGradient>
        <radialGradient id="glow" cx="72%" cy="28%" r="50%">
          <stop offset="0%" stop-color="${glow}" stop-opacity="0.9" />
          <stop offset="100%" stop-color="${glow}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="960" height="640" fill="url(#bg)" />
      <rect width="960" height="640" fill="url(#glow)" />
      <g opacity="0.22" stroke="white" stroke-width="2">
        <path d="M-30 140C130 60 250 60 470 120S830 210 1010 80" fill="none" />
        <path d="M-10 410C120 320 300 280 470 340S830 520 990 420" fill="none" />
      </g>
      <g fill="white">
        <text x="64" y="110" font-size="28" font-family="Arial, sans-serif" opacity="0.78">${subtitle}</text>
        <text x="64" y="188" font-size="64" font-weight="700" font-family="Arial, sans-serif">${title}</text>
        <text x="64" y="248" font-size="24" font-family="Arial, sans-serif" opacity="0.82">Schema mock preview</text>
      </g>
      <g transform="translate(690 420)">
        <circle cx="90" cy="50" r="84" fill="rgba(255,255,255,0.14)" />
        <path d="M88 8C54 8 26 36 26 70c0 46 62 118 62 118s62-72 62-118C150 36 122 8 88 8Z" fill="#F3EDE4" />
        <circle cx="88" cy="70" r="24" fill="${accent}" />
      </g>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const sharedPoints: PilgrimagePoint[] = [
  {
    id: "uji-bridge",
    name: "宇治橋",
    name_cn: "宇治桥",
    episode: 1,
    time_seconds: 42,
    screenshot_url: createPoster("宇治桥", "Episode 1 arrival", "#DD7A3A", "#FFD9A6"),
    address: "京都府宇治市宇治",
    bangumi_id: "115908",
    latitude: 34.88958,
    longitude: 135.80781,
    title: "響け！ユーフォニアム",
    title_cn: "吹响吧！上低音号",
    origin: "anitabi",
  },
  {
    id: "keihan-uji",
    name: "京阪宇治駅",
    name_cn: "京阪宇治站",
    episode: 1,
    time_seconds: 83,
    screenshot_url: createPoster("京阪宇治站", "Daily commute", "#6B836D", "#D9F4D1"),
    address: "京都府宇治市宇治乙方",
    bangumi_id: "115908",
    latitude: 34.89024,
    longitude: 135.80954,
    title: "響け！ユーフォニアム",
    title_cn: "吹响吧！上低音号",
    origin: "anitabi",
  },
  {
    id: "uji-shrine",
    name: "宇治神社",
    name_cn: "宇治神社",
    episode: 5,
    time_seconds: 311,
    screenshot_url: createPoster("宇治神社", "Quiet break", "#4B5A87", "#C4D6FF"),
    address: "京都府宇治市宇治山田",
    bangumi_id: "115908",
    latitude: 34.89264,
    longitude: 135.81091,
    title: "響け！ユーフォニアム",
    title_cn: "吹响吧！上低音号",
    origin: "anitabi",
  },
  {
    id: "asagiri-bridge",
    name: "朝霧橋",
    name_cn: "朝雾桥",
    episode: 8,
    time_seconds: 525,
    screenshot_url: createPoster("朝雾桥", "Golden-hour duet", "#8C5A5A", "#FFD8D8"),
    address: "京都府宇治市宇治東内",
    bangumi_id: "115908",
    latitude: 34.89106,
    longitude: 135.81198,
    title: "響け！ユーフォニアム",
    title_cn: "吹响吧！上低音号",
    origin: "anitabi",
  },
  {
    id: "byodoin-approach",
    name: "平等院表参道",
    name_cn: "平等院表参道",
    episode: 13,
    time_seconds: 1024,
    screenshot_url: createPoster("平等院表参道", "Finale route", "#8A6D2F", "#FFF0B8"),
    address: "京都府宇治市宇治蓮華",
    bangumi_id: "115908",
    latitude: 34.88977,
    longitude: 135.80917,
    title: "響け！ユーフォニアム",
    title_cn: "吹响吧！上低音号",
    origin: "anitabi",
  },
];

export const bangumiSearchMock: SearchResultData = {
  status: "ok",
  message: "找到 5 个适合半日巡礼的场景。",
  results: {
    rows: sharedPoints,
    row_count: sharedPoints.length,
    strategy: "hybrid",
    status: "ok",
    metadata: {
      source: "schema-mock",
      location_hint: "宇治",
      bangumi_id: "115908",
    },
    summary: {
      count: sharedPoints.length,
      strategy: "hybrid",
      source: "schema-mock",
      cache: "warm",
    },
  },
};

export const nearbySearchMock: SearchResultData = {
  status: "ok",
  message: "宇治站步行 15 分钟内可到达 3 个场景。",
  results: {
    rows: [
      { ...sharedPoints[1], distance_m: 180 },
      { ...sharedPoints[0], distance_m: 340 },
      { ...sharedPoints[4], distance_m: 760 },
    ],
    row_count: 3,
    strategy: "geo",
    status: "ok",
    metadata: {
      source: "schema-mock",
      origin: "宇治站",
      radius_m: 1200,
    },
    summary: {
      count: 3,
      strategy: "geo",
      source: "schema-mock",
      cache: "miss",
    },
  },
};

export const routeMock: RouteData = {
  status: "ok",
  message: "已为你排出一条 4.2km 的顺路巡礼线。",
  results: {
    rows: sharedPoints,
    row_count: sharedPoints.length,
    strategy: "hybrid",
    status: "ok",
    metadata: {
      source: "schema-mock",
      origin: "宇治站",
      route_mode: "walking",
    },
    summary: {
      count: sharedPoints.length,
      strategy: "hybrid",
      source: "schema-mock",
      cache: "warm",
    },
  },
  route: {
    ordered_points: sharedPoints,
    point_count: sharedPoints.length,
    status: "ok",
    summary: {
      point_count: sharedPoints.length,
      with_coordinates: sharedPoints.length,
      without_coordinates: 0,
    },
  },
};

export const routeHistoryMock: RouteHistoryRecord[] = [
  {
    route_id: "route-uji-afternoon",
    bangumi_id: "115908",
    origin_station: "宇治站",
    point_count: 5,
    status: "ok",
    created_at: "2026-03-24T14:15:00+08:00",
  },
  {
    route_id: "route-shinjuku-kiminona",
    bangumi_id: "160209",
    origin_station: "新宿站",
    point_count: 4,
    status: "ok",
    created_at: "2026-03-22T19:40:00+08:00",
  },
];

export const redesignScenarios = {
  bangumi: {
    key: "bangumi",
    label: "作品找场景",
    kicker: "Search By Bangumi",
    headline: "先用剧照挑场景，再决定要不要排路线。",
    subline: "适合第一次来宇治的用户，先建立兴趣，再进入路线规划。",
    search: bangumiSearchMock,
    prompt: "吹响吧！上低音号有哪些值得先去的场景？",
  },
  nearby: {
    key: "nearby",
    label: "地点找作品",
    kicker: "Search By Location",
    headline: "站点是入口，用户能先看附近有什么，再决定追哪部番。",
    subline: "把“我现在就在这里”这种临场需求放到第一层。",
    search: nearbySearchMock,
    prompt: "宇治站附近 15 分钟内有哪些场景？",
  },
  route: {
    key: "route",
    label: "直接排路线",
    kicker: "Plan Route",
    headline: "把聊天变成参数输入，主视图改成真正可操作的巡礼工作台。",
    subline: "场景池、路线、地图、休息点建议都在一个页面里联动。",
    route: routeMock,
    prompt: "从宇治站出发，排一个半日巡礼路线。",
  },
} as const;

export type RedesignScenarioKey = keyof typeof redesignScenarios;
