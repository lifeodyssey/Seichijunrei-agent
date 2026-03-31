"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  bangumiSearchMock,
  nearbySearchMock,
  routeHistoryMock,
  routeMock,
} from "../../lib/demo-data";
import type { PilgrimagePoint } from "../../lib/types";

type LocaleKey = "zh" | "ja";
type ResultMode = "home" | "title" | "nearby" | "route" | "answer" | "clarify";

const copy = {
  zh: {
    brand: {
      name: "圣地巡礼 AI",
      subtitle: "anime pilgrimage planner",
    },
    topbar: {
      saved: "继续上次路线",
    },
    search: {
      placeholder: "搜作品、地点，或直接说“从宇治站出发排路线”",
      submit: "发送",
      quickTitle: "快速开始",
      quickStarts: [
        { label: "搜作品场景", query: "吹响吧！上低音号有哪些值得先去的场景？", mode: "title" as const },
        { label: "看我附近", query: "宇治站附近 15 分钟内有什么场景？", mode: "nearby" as const },
        { label: "继续上次路线", query: "继续我上次保存的路线", mode: "route" as const },
      ],
    },
    activity: {
      title: "最近操作",
      empty: "开始一次查询后，结果会在这里持续更新。",
    },
    home: {
      label: "开始",
      title: "今天想怎么开始巡礼？",
      body:
        "输入作品、地点或路线需求，页面会直接切换成最适合当前任务的结果视图。",
      entries: [
        {
          title: "按作品找场景",
          body: "先看截图和场景，再决定今天要不要围绕这部作品出发。",
          action: "开始看作品场景",
          mode: "title" as const,
          query: "吹响吧！上低音号有哪些值得先去的场景？",
        },
        {
          title: "看我附近",
          body: "如果你已经在车站附近，先回答现在值不值得拐过去。",
          action: "开始看附近",
          mode: "nearby" as const,
          query: "宇治站附近 15 分钟内有什么场景？",
        },
        {
          title: "继续上次路线",
          body: "回到上一次保存的路线，直接继续调整顺序和时长。",
          action: "继续路线",
          mode: "route" as const,
          query: "继续我上次保存的路线",
        },
      ],
      savedTitle: "最近保存",
    },
    modeLabel: {
      title: "作品场景",
      nearby: "附近可去",
      route: "今日路线",
      answer: "简短回答",
      clarify: "继续细化",
    },
    title: {
      heading: "作品场景",
      title: "吹响吧！上低音号",
      summary: "宇治 5 个可看场景",
      filters: ["名场面", "车站附近", "半日友好", "已加入"],
      browserTitle: "场景列表",
      browserHint: "先把今天真正想去的点加入路线，再决定顺序。",
      mapTitle: "地图预览",
      mapHint: "地图只用来判断这些点是不是顺路，不抢主视图。",
      add: "加入路线",
      added: "已加入",
      openRoute: "用已选点生成路线",
    },
    nearby: {
      heading: "附近可去",
      title: "宇治站附近",
      summary: "步行 15 分钟内可到达的场景",
      listTitle: "先去这些点更稳",
      listHint: "优先按距离和步行成本看，再决定要不要继续扩线。",
      worksTitle: "从这里还能顺手看的作品",
      worksHint: "先看地点，再回到作品，是更自然的浏览方式。",
      add: "加入路线",
      added: "已加入",
      openRoute: "从这些点生成路线",
      works: ["吹响吧！上低音号", "玉子市场", "冰菓"],
    },
    route: {
      heading: "今日路线",
      title: "把今天的巡礼定下来",
      summaryReady: "已根据当前已选点生成路线",
      summaryEmpty: "先加两个点，再开始排路线",
      timelineTitle: "路线顺序",
      timelineHint: "顺序一旦定下来，距离和时长就更容易判断。",
      summaryTitle: "路线摘要",
      summaryItems: {
        distance: "总距离",
        duration: "预计时长",
        stops: "停靠点",
      },
      aiTitle: "继续调整",
      aiActions: [
        "压缩成 2 小时轻量版",
        "把桥和神社提前到前半段",
        "只保留第一次来最值得去的 3 个点",
      ],
      needMoreTitle: "再加至少一个点",
      needMoreBody: "现在还不够形成一条路线。你可以继续在作品结果或附近结果里加点。",
      backToTitle: "回到作品场景",
      backToNearby: "回到附近结果",
      save: "保存路线",
    },
    answer: {
      heading: "简短回答",
      title: "宇治更适合半日到一日巡礼。",
      body:
        "如果你想轻量一点，优先看宇治桥、京阪宇治站、朝雾桥；如果还想加点，再把神社和表参道放进去。",
      actions: ["看看附近结果", "直接生成路线"],
    },
    clarify: {
      heading: "继续细化",
      title: "你可以直接说得更具体一点。",
      suggestions: [
        "吹响吧！上低音号有哪些场景值得先去？",
        "宇治站附近 15 分钟内有什么场景？",
        "从宇治站出发帮我排一个半日路线",
      ],
    },
    tray: {
      title: "今日路线",
      clear: "清空",
      build: "查看路线",
    },
    locale: {
      current: "中文",
      other: "日本語",
    },
  },
  ja: {
    brand: {
      name: "聖地巡礼 AI",
      subtitle: "anime pilgrimage planner",
    },
    topbar: {
      saved: "前回のルートを続ける",
    },
    search: {
      placeholder: "作品、場所、または「宇治駅からルートを組む」と入力",
      submit: "送信",
      quickTitle: "クイックスタート",
      quickStarts: [
        { label: "作品から探す", query: "響け！ユーフォニアム の行きたい場面を見せて", mode: "title" as const },
        { label: "近くから見る", query: "宇治駅の近くで歩いて行ける場面は？", mode: "nearby" as const },
        { label: "前回のルート", query: "前回保存したルートを続ける", mode: "route" as const },
      ],
    },
    activity: {
      title: "最近の操作",
      empty: "検索を始めると、ここに最近の操作が残ります。",
    },
    home: {
      label: "開始",
      title: "今日はどこから巡礼を始めますか？",
      body:
        "作品、場所、ルートのどこからでも始められます。入力すると結果エリアがそのまま切り替わります。",
      entries: [
        {
          title: "作品から場面を見る",
          body: "まず場面とスクリーンショットを見て、その作品で今日は本当に回るか決める。",
          action: "作品から始める",
          mode: "title" as const,
          query: "響け！ユーフォニアム の行きたい場面を見せて",
        },
        {
          title: "今いる場所から見る",
          body: "駅や街の近くにいるなら、まず今寄る価値がある点を返す。",
          action: "近くから始める",
          mode: "nearby" as const,
          query: "宇治駅の近くで歩いて行ける場面は？",
        },
        {
          title: "前回のルートを続ける",
          body: "保存済みルートに戻り、順番と時長をそのまま調整する。",
          action: "ルートを続ける",
          mode: "route" as const,
          query: "前回保存したルートを続ける",
        },
      ],
      savedTitle: "最近保存したルート",
    },
    modeLabel: {
      title: "作品の場面",
      nearby: "近くで行ける場所",
      route: "今日のルート",
      answer: "短い回答",
      clarify: "もう少し具体的に",
    },
    title: {
      heading: "作品の場面",
      title: "響け！ユーフォニアム",
      summary: "宇治で見に行ける 5 場面",
      filters: ["名場面", "駅から近い", "半日向き", "追加済み"],
      browserTitle: "場面リスト",
      browserHint: "まず今日行く点を残してから、最後に順番を決めます。",
      mapTitle: "地図プレビュー",
      mapHint: "地図は順路の見え方だけを補助します。",
      add: "ルートに入れる",
      added: "追加済み",
      openRoute: "この候補でルートを見る",
    },
    nearby: {
      heading: "近くで行ける場所",
      title: "宇治駅の近く",
      summary: "徒歩 15 分圏内の場面",
      listTitle: "まず見に行きやすい点",
      listHint: "距離と歩きやすさを優先して見ていく。",
      worksTitle: "ここから追いやすい作品",
      worksHint: "場所から作品へ戻るための入口も残しておく。",
      add: "ルートに入れる",
      added: "追加済み",
      openRoute: "この点でルートを作る",
      works: ["響け！ユーフォニアム", "たまこまーけっと", "氷菓"],
    },
    route: {
      heading: "今日のルート",
      title: "今日の巡礼ルートを固める",
      summaryReady: "現在の選択からルートを組みました",
      summaryEmpty: "まず 2 点以上選ぶとルートが組めます",
      timelineTitle: "回る順番",
      timelineHint: "順番が決まると、距離と時長が見やすくなります。",
      summaryTitle: "ルート概要",
      summaryItems: {
        distance: "総距離",
        duration: "想定時間",
        stops: "立ち寄り",
      },
      aiTitle: "さらに整える",
      aiActions: [
        "2 時間の軽量版へ圧縮する",
        "橋と神社を前半へ寄せる",
        "初回向けに 3 箇所だけ残す",
      ],
      needMoreTitle: "あと 1 点追加してください",
      needMoreBody: "まだルートを組むには足りません。作品結果か近く結果に戻って点を追加できます。",
      backToTitle: "作品結果へ戻る",
      backToNearby: "近く結果へ戻る",
      save: "ルートを保存",
    },
    answer: {
      heading: "短い回答",
      title: "宇治は半日から 1 日で回しやすい巡礼先です。",
      body:
        "軽めなら宇治橋、京阪宇治駅、朝霧橋を優先し、時間があれば神社と表参道を追加するのが回しやすいです。",
      actions: ["近くの結果を見る", "そのままルートを作る"],
    },
    clarify: {
      heading: "もう少し具体的に",
      title: "この 3 つの言い方ならそのまま始められます。",
      suggestions: [
        "響け！ユーフォニアム の行きたい場面を見せて",
        "宇治駅の近くで歩いて行ける場面は？",
        "宇治駅から半日のルートを作って",
      ],
    },
    tray: {
      title: "今日のルート",
      clear: "クリア",
      build: "ルートを見る",
    },
    locale: {
      current: "日本語",
      other: "中文",
    },
  },
} as const;

function resolveLocale(lang: string): LocaleKey {
  return lang === "ja" ? "ja" : "zh";
}

function routePath(lang: string) {
  return `/${lang}/design`;
}

function distanceLabel(distance?: number) {
  if (distance == null) return "自由探索";
  return distance < 1000
    ? `${Math.round(distance)}m`
    : `${(distance / 1000).toFixed(1)}km`;
}

function minutesFromSeconds(seconds: number, locale: LocaleKey) {
  const minutes = Math.max(6, Math.round(seconds / 45));
  return locale === "ja" ? `${minutes}分` : `${minutes} 分钟`;
}

function estimateRouteMinutes(points: PilgrimagePoint[]) {
  return Math.max(
    points.length * 18,
    Math.round(points.reduce((sum, point) => sum + point.time_seconds, 0) / 60) +
      points.length * 16,
  );
}

function formatDuration(minutes: number, locale: LocaleKey) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours <= 0) {
    return locale === "ja" ? `${rest}分` : `${rest} 分钟`;
  }

  return locale === "ja"
    ? `${hours}時間 ${rest}分`
    : `${hours}h ${rest}m`;
}

function routeDistance(points: PilgrimagePoint[]) {
  if (points.length <= 1) return 0;

  const toRadians = (value: number) => (value * Math.PI) / 180;
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dLat = toRadians(b.latitude - a.latitude);
    const dLng = toRadians(b.longitude - a.longitude);
    const lat1 = toRadians(a.latitude);
    const lat2 = toRadians(b.latitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    total += 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1.35;
  }

  return total;
}

function buildMapPoints(points: PilgrimagePoint[]) {
  const lats = points.map((point) => point.latitude);
  const lngs = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return points.map((point, index) => ({
    ...point,
    x:
      12 +
      ((point.longitude - minLng) / Math.max(0.0001, maxLng - minLng)) * 76,
    y:
      14 +
      ((maxLat - point.latitude) / Math.max(0.0001, maxLat - minLat)) * 68,
    order: index + 1,
  }));
}

function detectMode(query: string): ResultMode {
  const text = query.trim().toLowerCase();

  if (!text) return "clarify";
  if (
    /(路线|路線|route|行程|怎么走|回る|巡る|ルート|顺路|少走路)/.test(text)
  ) {
    return "route";
  }
  if (/(附近|近く|near|駅|车站|車站|station|周边|周辺)/.test(text)) {
    return "nearby";
  }
  if (
    /(几集|哪一集|什么时候|是什么|是谁|why|what|where|how long|何話|いつ|どこ|誰)/.test(
      text,
    )
  ) {
    return "answer";
  }
  if (text.length < 4) return "clarify";
  return "title";
}

function uniqueById(points: PilgrimagePoint[]) {
  const seen = new Map<string, PilgrimagePoint>();
  for (const point of points) {
    if (!seen.has(point.id)) seen.set(point.id, point);
  }
  return [...seen.values()];
}

function Surface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[28px] border border-[#ddd1c2] bg-[#fbf7f2] shadow-[0_18px_50px_rgba(82,59,35,0.06)] ${className}`}
    >
      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.28em] text-[#8d7c68]">
      {children}
    </p>
  );
}

function StudioMap({
  points,
  routeIds,
  height = 360,
}: {
  points: PilgrimagePoint[];
  routeIds?: string[];
  height?: number;
}) {
  const plotted = buildMapPoints(points);
  const activeIds = routeIds ?? [];
  const routePoints = plotted.filter((point) => activeIds.includes(point.id));
  const routeOrder = new Map(activeIds.map((id, index) => [id, index + 1]));
  const polyline = routePoints.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div
      className="relative overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.95),rgba(242,234,223,0.92)_42%,rgba(227,214,197,0.98)_100%)]"
      style={{ height }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(147,129,104,0.12),transparent_36%),linear-gradient(0deg,rgba(255,255,255,0.3),transparent_52%)]" />
      <div className="absolute left-[11%] top-[14%] h-[2px] w-[72%] rounded-full bg-[#cfb38e]" />
      <div className="absolute left-[18%] top-[18%] h-[64%] w-[2px] rounded-full bg-[#b9c2ae]" />
      <div className="absolute right-[10%] top-[10%] rounded-full bg-white/82 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#7d6b58]">
        Uji River
      </div>
      <div className="absolute left-[8%] bottom-[14%] rounded-full bg-white/82 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[#687653]">
        JR Nara Line
      </div>

      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        {routePoints.length > 1 ? (
          <polyline
            points={polyline}
            fill="none"
            stroke="#b36c2f"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1.4 1"
          />
        ) : null}
      </svg>

      {plotted.map((point) => {
        const active = activeIds.includes(point.id);

        return (
          <div
            key={point.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <div
              className={`flex items-center gap-2 rounded-full border px-2 py-2 ${
                active
                  ? "border-[#181511] bg-[#181511] text-white"
                  : "border-white/80 bg-white/88 text-[#181511]"
              }`}
            >
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                  active ? "bg-white text-[#181511]" : "bg-[#181511] text-white"
                }`}
              >
                {active ? routeOrder.get(point.id) : "•"}
              </div>
              <div className="pr-1">
                <p className="max-w-[132px] truncate text-xs font-medium">
                  {point.name_cn || point.name}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopBar({
  locale,
  onResumeRoute,
}: {
  locale: LocaleKey;
  onResumeRoute: () => void;
}) {
  const ui = copy[locale];
  const otherLang = locale === "ja" ? "zh" : "ja";

  return (
    <div className="flex flex-col gap-4 border-b border-[#dfd2c3] pb-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[#181511] text-sm font-semibold text-white">
          聖
        </div>
        <div>
          <p className="text-sm font-semibold text-[#181511]">{ui.brand.name}</p>
          <p className="text-xs text-[#7a6b5d]">{ui.brand.subtitle}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onResumeRoute}
          className="rounded-full border border-[#d8cbbe] bg-white px-4 py-2 text-sm text-[#181511]"
        >
          {ui.topbar.saved}
        </button>
        <Link
          href={routePath(otherLang)}
          className="rounded-full border border-[#d8cbbe] bg-white px-3 py-2 text-xs font-medium text-[#695b4d]"
        >
          {copy[otherLang].locale.current}
        </Link>
      </div>
    </div>
  );
}

function Composer({
  locale,
  draftQuery,
  onDraftChange,
  onSubmit,
  onQuickStart,
}: {
  locale: LocaleKey;
  draftQuery: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onQuickStart: (query: string, mode: ResultMode) => void;
}) {
  const ui = copy[locale];

  return (
    <Surface className="overflow-hidden">
      <div className="px-6 pb-6 pt-6">
        <div className="max-w-[760px]">
          <SectionLabel>{ui.home.label}</SectionLabel>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[#181511] md:text-5xl">
            {ui.home.title}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-8 text-[#625548]">
            {ui.home.body}
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3 lg:flex-row">
          <input
            value={draftQuery}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={ui.search.placeholder}
            className="h-14 flex-1 rounded-full border border-[#d8cbbe] bg-white px-5 text-[15px] text-[#181511] outline-none placeholder:text-[#8f7f6e]"
          />
          <button
            type="submit"
            className="h-14 rounded-full bg-[#181511] px-7 text-sm font-medium text-white"
          >
            {ui.search.submit}
          </button>
        </form>

        <div className="mt-5">
          <SectionLabel>{ui.search.quickTitle}</SectionLabel>
          <div className="mt-3 flex flex-wrap gap-2">
            {ui.search.quickStarts.map((item) => (
              <button
                key={item.label}
                onClick={() => onQuickStart(item.query, item.mode)}
                className="rounded-full border border-[#d8cbbe] bg-white px-4 py-2 text-sm text-[#181511]"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Surface>
  );
}

function ActivityRail({
  locale,
  items,
}: {
  locale: LocaleKey;
  items: Array<{ id: number; query: string; label: string }>;
}) {
  const ui = copy[locale];

  return (
    <Surface className="h-full">
      <div className="border-b border-[#e4d8ca] px-5 py-4">
        <SectionLabel>{ui.activity.title}</SectionLabel>
      </div>

      {items.length === 0 ? (
        <div className="px-5 py-5 text-sm leading-7 text-[#6d6052]">
          {ui.activity.empty}
        </div>
      ) : (
        <div className="divide-y divide-[#ece2d7]">
          {items.map((item) => (
            <div key={item.id} className="px-5 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[#8d7c68]">
                {item.label}
              </p>
              <p className="mt-2 text-sm leading-7 text-[#181511]">{item.query}</p>
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

function HomeEntries({
  locale,
  onStart,
}: {
  locale: LocaleKey;
  onStart: (query: string, mode: ResultMode) => void;
}) {
  const ui = copy[locale];

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {ui.home.entries.map((entry) => (
        <Surface key={entry.title} className="p-6">
          <p className="text-xl font-semibold tracking-[-0.03em] text-[#181511]">
            {entry.title}
          </p>
          <p className="mt-3 text-sm leading-7 text-[#65584b]">{entry.body}</p>
          <button
            onClick={() => onStart(entry.query, entry.mode)}
            className="mt-6 rounded-full bg-[#181511] px-5 py-3 text-sm font-medium text-white"
          >
            {entry.action}
          </button>
        </Surface>
      ))}
    </div>
  );
}

function SavedRoutes({
  locale,
  onResumeRoute,
}: {
  locale: LocaleKey;
  onResumeRoute: () => void;
}) {
  const ui = copy[locale];

  return (
    <Surface>
      <div className="border-b border-[#e4d8ca] px-6 py-4">
        <SectionLabel>{ui.home.savedTitle}</SectionLabel>
      </div>

      <div className="divide-y divide-[#ece2d7]">
        {routeHistoryMock.map((route) => (
          <div key={route.route_id ?? route.created_at} className="px-6 py-4">
            <p className="text-base font-semibold text-[#181511]">
              {route.origin_station}
            </p>
            <p className="mt-1 text-sm text-[#6d6052]">
              {route.point_count}
              {locale === "ja" ? "スポット" : " 个点"} · {route.created_at.slice(5, 16).replace("T", " ")}
            </p>
            <button
              onClick={onResumeRoute}
              className="mt-4 rounded-full border border-[#d8cbbe] bg-white px-4 py-2 text-sm font-medium text-[#181511]"
            >
              {ui.topbar.saved}
            </button>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function ResultHeader({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-3">
      <SectionLabel>{label}</SectionLabel>
      <h2 className="text-3xl font-semibold tracking-[-0.04em] text-[#181511] md:text-4xl">
        {title}
      </h2>
      <p className="max-w-3xl text-base leading-8 text-[#625548]">{body}</p>
    </div>
  );
}

function SceneRow({
  point,
  locale,
  selected,
  actionLabel,
  onSelect,
}: {
  point: PilgrimagePoint;
  locale: LocaleKey;
  selected: boolean;
  actionLabel: string;
  onSelect: () => void;
}) {
  return (
    <div className="grid gap-4 px-5 py-5 md:grid-cols-[128px_minmax(0,1fr)_120px] md:items-center">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[18px] bg-[#e7ddd0]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={point.screenshot_url}
          alt={point.name_cn || point.name}
          className="h-full w-full object-cover"
        />
      </div>

      <div>
        <p className="text-lg font-semibold tracking-[-0.03em] text-[#181511]">
          {point.name_cn || point.name}
        </p>
        <p className="mt-2 text-sm text-[#65584b]">
          {point.title_cn || point.title}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#8a7a67]">
          <span>Episode {point.episode}</span>
          <span>{minutesFromSeconds(point.time_seconds, locale)}</span>
          <span>{distanceLabel(point.distance_m)}</span>
        </div>
      </div>

      <div className="flex items-center md:justify-end">
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className={`rounded-full px-4 py-2 text-sm font-medium ${
            selected
              ? "bg-[#181511] text-white"
              : "border border-[#d8cbbe] bg-white text-[#181511]"
          }`}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

function TitleResults({
  locale,
  selectedIds,
  onSelect,
  onOpenRoute,
}: {
  locale: LocaleKey;
  selectedIds: string[];
  onSelect: (pointId: string) => void;
  onOpenRoute: () => void;
}) {
  const ui = copy[locale];
  const points = bangumiSearchMock.results.rows;
  const previewIds =
    points.filter((point) => selectedIds.includes(point.id)).map((point) => point.id) ||
    [];
  const routeIds = previewIds.length > 0 ? previewIds : points.slice(0, 3).map((point) => point.id);

  return (
    <div className="space-y-6">
      <ResultHeader
        label={ui.title.heading}
        title={ui.title.title}
        body={ui.title.summary}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Surface className="overflow-hidden">
            <div className="grid xl:grid-cols-[0.44fr_0.56fr]">
              <div className="relative min-h-[360px] bg-[#181511]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={points[0].screenshot_url}
                  alt={points[0].name_cn || points[0].name}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(24,21,17,0.08),rgba(24,21,17,0.8))]" />
                <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                  <SectionLabel>Featured</SectionLabel>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white">
                    {points[0].name_cn || points[0].name}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-white/72">
                    {points[0].title_cn || points[0].title}
                  </p>
                </div>
              </div>

              <div className="px-6 py-6">
                <SectionLabel>{ui.title.browserTitle}</SectionLabel>
                <p className="mt-3 text-base leading-8 text-[#625548]">
                  {ui.title.browserHint}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {ui.title.filters.map((filter) => (
                    <span
                      key={filter}
                      className="rounded-full border border-[#d8cbbe] bg-white px-3 py-1 text-xs text-[#695b4d]"
                    >
                      {filter}
                    </span>
                  ))}
                </div>
                <button
                  onClick={onOpenRoute}
                  className="mt-6 rounded-full bg-[#181511] px-5 py-3 text-sm font-medium text-white"
                >
                  {ui.title.openRoute}
                </button>
              </div>
            </div>
          </Surface>

          <Surface>
            <div className="border-b border-[#e4d8ca] px-6 py-4">
              <SectionLabel>{ui.title.browserTitle}</SectionLabel>
            </div>
            <div className="divide-y divide-[#ece2d7]">
              {points.map((point) => {
                const selected = selectedIds.includes(point.id);
                return (
                  <SceneRow
                    key={point.id}
                    point={point}
                    locale={locale}
                    selected={selected}
                    actionLabel={selected ? ui.title.added : ui.title.add}
                    onSelect={() => onSelect(point.id)}
                  />
                );
              })}
            </div>
          </Surface>
        </div>

        <Surface className="p-5">
          <SectionLabel>{ui.title.mapTitle}</SectionLabel>
          <p className="mt-3 text-sm leading-7 text-[#65584b]">{ui.title.mapHint}</p>
          <div className="mt-5">
            <StudioMap points={points} routeIds={routeIds} height={420} />
          </div>
        </Surface>
      </div>
    </div>
  );
}

function NearbyResults({
  locale,
  selectedIds,
  onSelect,
  onOpenRoute,
}: {
  locale: LocaleKey;
  selectedIds: string[];
  onSelect: (pointId: string) => void;
  onOpenRoute: () => void;
}) {
  const ui = copy[locale];
  const points = nearbySearchMock.results.rows;
  const routeIds =
    points.filter((point) => selectedIds.includes(point.id)).map((point) => point.id).length > 0
      ? points.filter((point) => selectedIds.includes(point.id)).map((point) => point.id)
      : points.map((point) => point.id);

  return (
    <div className="space-y-6">
      <ResultHeader
        label={ui.nearby.heading}
        title={ui.nearby.title}
        body={ui.nearby.summary}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Surface className="p-5">
          <StudioMap points={points} routeIds={routeIds} height={620} />
        </Surface>

        <div className="space-y-6">
          <Surface>
            <div className="border-b border-[#e4d8ca] px-6 py-4">
              <SectionLabel>{ui.nearby.listTitle}</SectionLabel>
              <p className="mt-2 text-sm leading-7 text-[#65584b]">
                {ui.nearby.listHint}
              </p>
            </div>
            <div className="divide-y divide-[#ece2d7]">
              {points.map((point) => {
                const selected = selectedIds.includes(point.id);
                return (
                  <SceneRow
                    key={point.id}
                    point={point}
                    locale={locale}
                    selected={selected}
                    actionLabel={selected ? ui.nearby.added : ui.nearby.add}
                    onSelect={() => onSelect(point.id)}
                  />
                );
              })}
            </div>
            <div className="border-t border-[#ece2d7] px-6 py-5">
              <button
                onClick={onOpenRoute}
                className="flex h-12 w-full items-center justify-center rounded-full bg-[#181511] text-sm font-medium text-white"
              >
                {ui.nearby.openRoute}
              </button>
            </div>
          </Surface>

          <Surface>
            <div className="border-b border-[#e4d8ca] px-6 py-4">
              <SectionLabel>{ui.nearby.worksTitle}</SectionLabel>
              <p className="mt-2 text-sm leading-7 text-[#65584b]">
                {ui.nearby.worksHint}
              </p>
            </div>
            <div className="divide-y divide-[#ece2d7]">
              {ui.nearby.works.map((work) => (
                <div key={work} className="px-6 py-4 text-base font-medium text-[#181511]">
                  {work}
                </div>
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  );
}

function RouteResults({
  locale,
  selectedPoints,
  onSwitchMode,
}: {
  locale: LocaleKey;
  selectedPoints: PilgrimagePoint[];
  onSwitchMode: (mode: ResultMode) => void;
}) {
  const ui = copy[locale];
  const routeReady = selectedPoints.length >= 2;
  const points = routeReady ? selectedPoints : [];
  const minutes = estimateRouteMinutes(points);
  const distance = routeDistance(points).toFixed(1);

  return (
    <div className="space-y-6">
      <ResultHeader
        label={ui.route.heading}
        title={ui.route.title}
        body={routeReady ? ui.route.summaryReady : ui.route.summaryEmpty}
      />

      {!routeReady ? (
        <Surface className="p-8">
          <p className="text-2xl font-semibold tracking-[-0.03em] text-[#181511]">
            {ui.route.needMoreTitle}
          </p>
          <p className="mt-3 max-w-2xl text-base leading-8 text-[#625548]">
            {ui.route.needMoreBody}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => onSwitchMode("title")}
              className="rounded-full bg-[#181511] px-5 py-3 text-sm font-medium text-white"
            >
              {ui.route.backToTitle}
            </button>
            <button
              onClick={() => onSwitchMode("nearby")}
              className="rounded-full border border-[#d8cbbe] bg-white px-5 py-3 text-sm font-medium text-[#181511]"
            >
              {ui.route.backToNearby}
            </button>
          </div>
        </Surface>
      ) : (
        <div className="grid gap-8 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Surface>
            <div className="border-b border-[#e4d8ca] px-6 py-4">
              <SectionLabel>{ui.route.timelineTitle}</SectionLabel>
              <p className="mt-2 text-sm leading-7 text-[#65584b]">
                {ui.route.timelineHint}
              </p>
            </div>
            <div className="space-y-0 px-6 py-5">
              {points.map((point, index) => (
                <div
                  key={point.id}
                  className="grid grid-cols-[36px_minmax(0,1fr)] gap-4 pb-5 last:pb-0"
                >
                  <div className="relative flex justify-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#181511] text-xs font-semibold text-white">
                      {index + 1}
                    </div>
                    {index < points.length - 1 ? (
                      <div className="absolute top-10 h-[calc(100%-2px)] w-px bg-[#d9ccbd]" />
                    ) : null}
                  </div>
                  <div className="rounded-[18px] border border-[#e3d7ca] bg-white px-4 py-4">
                    <p className="text-sm font-semibold text-[#181511]">
                      {point.name_cn || point.name}
                    </p>
                    <p className="mt-1 text-xs text-[#6e6052]">
                      Episode {point.episode} · {minutesFromSeconds(point.time_seconds, locale)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Surface>

          <div className="space-y-6">
            <Surface className="p-5">
              <StudioMap
                points={points}
                routeIds={points.map((point) => point.id)}
                height={410}
              />
            </Surface>

            <Surface>
              <div className="border-b border-[#e4d8ca] px-6 py-4">
                <SectionLabel>{ui.route.summaryTitle}</SectionLabel>
              </div>
              <div className="divide-y divide-[#ece2d7]">
                <div className="flex items-center justify-between px-6 py-4 text-sm">
                  <span className="text-[#65584b]">{ui.route.summaryItems.distance}</span>
                  <span className="font-semibold text-[#181511]">{distance}km</span>
                </div>
                <div className="flex items-center justify-between px-6 py-4 text-sm">
                  <span className="text-[#65584b]">{ui.route.summaryItems.duration}</span>
                  <span className="font-semibold text-[#181511]">
                    {formatDuration(minutes, locale)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-6 py-4 text-sm">
                  <span className="text-[#65584b]">{ui.route.summaryItems.stops}</span>
                  <span className="font-semibold text-[#181511]">{points.length}</span>
                </div>
              </div>
            </Surface>

            <Surface>
              <div className="border-b border-[#e4d8ca] px-6 py-4">
                <SectionLabel>{ui.route.aiTitle}</SectionLabel>
              </div>
              <div className="space-y-3 px-6 py-5">
                {ui.route.aiActions.map((action) => (
                  <button
                    key={action}
                    className="w-full rounded-full border border-[#d8cbbe] bg-white px-4 py-3 text-left text-sm text-[#181511]"
                  >
                    {action}
                  </button>
                ))}
                <button className="w-full rounded-full bg-[#181511] px-4 py-3 text-sm font-medium text-white">
                  {ui.route.save}
                </button>
              </div>
            </Surface>
          </div>
        </div>
      )}
    </div>
  );
}

function AnswerResults({
  locale,
  onAction,
}: {
  locale: LocaleKey;
  onAction: (mode: ResultMode) => void;
}) {
  const ui = copy[locale];

  return (
    <div className="space-y-6">
      <ResultHeader
        label={ui.answer.heading}
        title={ui.answer.title}
        body={ui.answer.body}
      />

      <Surface className="p-6">
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => onAction("nearby")}
            className="rounded-full border border-[#d8cbbe] bg-white px-5 py-3 text-sm font-medium text-[#181511]"
          >
            {ui.answer.actions[0]}
          </button>
          <button
            onClick={() => onAction("route")}
            className="rounded-full bg-[#181511] px-5 py-3 text-sm font-medium text-white"
          >
            {ui.answer.actions[1]}
          </button>
        </div>
      </Surface>
    </div>
  );
}

function ClarifyResults({
  locale,
  onPick,
}: {
  locale: LocaleKey;
  onPick: (query: string, mode: ResultMode) => void;
}) {
  const ui = copy[locale];

  return (
    <div className="space-y-6">
      <ResultHeader
        label={ui.clarify.heading}
        title={ui.clarify.title}
        body=""
      />

      <Surface>
        <div className="divide-y divide-[#ece2d7]">
          {ui.clarify.suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              onClick={() => onPick(suggestion, index === 1 ? "nearby" : index === 2 ? "route" : "title")}
              className="block w-full px-6 py-5 text-left"
            >
              <p className="text-base font-medium text-[#181511]">{suggestion}</p>
            </button>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function RouteTray({
  locale,
  points,
  onClear,
  onRemove,
  onBuild,
}: {
  locale: LocaleKey;
  points: PilgrimagePoint[];
  onClear: () => void;
  onRemove: (pointId: string) => void;
  onBuild: () => void;
}) {
  const ui = copy[locale];

  if (points.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-30 rounded-[24px] border border-[#d7cabd] bg-[#181511] p-4 text-white shadow-[0_30px_80px_rgba(24,21,17,0.32)] sm:bottom-6 sm:left-auto sm:right-6 sm:w-[320px]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{ui.tray.title}</p>
          <p className="mt-1 text-xs text-white/58">
            {points.length}
            {locale === "ja" ? "スポットを選択中" : " 个点已加入"}
          </p>
        </div>
        <button
          onClick={onClear}
          className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 text-xs text-white/74"
        >
          {ui.tray.clear}
        </button>
      </div>

      <div className="mt-4 max-h-[180px] space-y-2 overflow-y-auto">
        {points.map((point, index) => (
          <div
            key={point.id}
            className="flex items-center justify-between rounded-[16px] border border-white/10 bg-white/6 px-3 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-[#181511]">
                {index + 1}
              </div>
              <p className="text-sm text-white">{point.name_cn || point.name}</p>
            </div>
            <button
              type="button"
              aria-label={
                locale === "ja"
                  ? `${point.name_cn || point.name} をルートから外す`
                  : `从路线中移除 ${point.name_cn || point.name}`
              }
              onClick={() => onRemove(point.id)}
              className="text-xs text-white/62"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onBuild}
        className="mt-4 flex h-11 w-full items-center justify-center rounded-full bg-white text-sm font-medium text-[#181511]"
      >
        {ui.tray.build}
      </button>
    </div>
  );
}

function DesignWorkbenchPage({
  lang,
  initialMode,
}: {
  lang: string;
  initialMode: ResultMode;
}) {
  const locale = resolveLocale(lang);
  const ui = copy[locale];
  const allPoints = uniqueById([
    ...bangumiSearchMock.results.rows,
    ...nearbySearchMock.results.rows,
    ...routeMock.route.ordered_points,
  ]);
  const initialSelectedIds =
    initialMode === "route"
      ? routeMock.route.ordered_points.map((point) => point.id)
      : [];
  const initialQuery =
    initialMode === "title"
      ? ui.search.quickStarts[0].query
      : initialMode === "nearby"
        ? ui.search.quickStarts[1].query
        : initialMode === "route"
          ? ui.search.quickStarts[2].query
          : "";

  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [mode, setMode] = useState<ResultMode>(initialMode);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [activity, setActivity] = useState<Array<{ id: number; query: string; label: string }>>(
    initialQuery
      ? [
          {
            id: 1,
            query: initialQuery,
            label: ui.modeLabel[initialMode as Exclude<ResultMode, "home">],
          },
        ]
      : [],
  );

  const selectedPoints = allPoints.filter((point) => selectedIds.includes(point.id));

  function pushActivity(query: string, nextMode: ResultMode) {
    if (nextMode === "home") return;

    const label =
      nextMode === "title" ||
      nextMode === "nearby" ||
      nextMode === "route" ||
      nextMode === "answer" ||
      nextMode === "clarify"
        ? ui.modeLabel[nextMode]
        : ui.home.label;

    setActivity((prev) => [
      { id: Date.now(), query, label },
      ...prev,
    ].slice(0, 3));
  }

  function openMode(nextMode: ResultMode, nextQuery: string) {
    if (nextMode === "route" && selectedIds.length === 0) {
      setSelectedIds(routeMock.route.ordered_points.map((point) => point.id));
    }
    setMode(nextMode);
    setDraftQuery(nextQuery);
    pushActivity(nextQuery, nextMode);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextQuery = draftQuery.trim();
    const nextMode = detectMode(nextQuery);
    openMode(nextMode, nextQuery);
  }

  function handleQuickStart(query: string, quickMode: ResultMode) {
    openMode(quickMode, query);
  }

  function handleSelectPoint(pointId: string) {
    setSelectedIds((prev) =>
      prev.includes(pointId) ? prev : [...prev, pointId],
    );
  }

  function handleRemovePoint(pointId: string) {
    setSelectedIds((prev) => prev.filter((id) => id !== pointId));
  }

  function handleClearRoute() {
    setSelectedIds([]);
  }

  function handleResumeRoute() {
    setSelectedIds(routeMock.route.ordered_points.map((point) => point.id));
    openMode("route", ui.search.quickStarts[2].query);
  }

  function renderResults() {
    switch (mode) {
      case "home":
        return (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <HomeEntries locale={locale} onStart={handleQuickStart} />
            </div>
            <SavedRoutes locale={locale} onResumeRoute={handleResumeRoute} />
          </div>
        );

      case "title":
        return (
          <TitleResults
            locale={locale}
            selectedIds={selectedIds}
            onSelect={handleSelectPoint}
            onOpenRoute={() => openMode("route", ui.title.openRoute)}
          />
        );

      case "nearby":
        return (
          <NearbyResults
            locale={locale}
            selectedIds={selectedIds}
            onSelect={handleSelectPoint}
            onOpenRoute={() => openMode("route", ui.nearby.openRoute)}
          />
        );

      case "route":
        return (
          <RouteResults
            locale={locale}
            selectedPoints={selectedPoints}
            onSwitchMode={(nextMode) => setMode(nextMode)}
          />
        );

      case "answer":
        return (
          <AnswerResults
            locale={locale}
            onAction={(nextMode) => {
              if (nextMode === "route" && selectedIds.length === 0) {
                setSelectedIds(routeMock.route.ordered_points.map((point) => point.id));
              }
              setMode(nextMode);
            }}
          />
        );

      case "clarify":
        return <ClarifyResults locale={locale} onPick={handleQuickStart} />;

      default:
        return null;
    }
  }

  return (
    <main className="min-h-screen bg-[#f4efe7] pb-44 text-[#181511] lg:pb-8">
      <div className="mx-auto max-w-[1480px] px-4 py-5 md:px-6 lg:px-8 lg:py-8">
        <TopBar locale={locale} onResumeRoute={handleResumeRoute} />

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-6">
            <Composer
              locale={locale}
              draftQuery={draftQuery}
              onDraftChange={setDraftQuery}
              onSubmit={handleSubmit}
              onQuickStart={handleQuickStart}
            />
            {renderResults()}
          </div>

          <ActivityRail locale={locale} items={activity} />
        </div>
      </div>

      <RouteTray
        locale={locale}
        points={selectedPoints}
        onClear={handleClearRoute}
        onRemove={handleRemovePoint}
        onBuild={() => openMode("route", ui.tray.build)}
      />
    </main>
  );
}

export function EntryScreen({ lang }: { lang: string }) {
  return <DesignWorkbenchPage lang={lang} initialMode="home" />;
}

export function ExploreScreen({ lang }: { lang: string }) {
  return <DesignWorkbenchPage lang={lang} initialMode="title" />;
}

export function NearbyScreen({ lang }: { lang: string }) {
  return <DesignWorkbenchPage lang={lang} initialMode="nearby" />;
}

export function RouteScreen({ lang }: { lang: string }) {
  return <DesignWorkbenchPage lang={lang} initialMode="route" />;
}

export default function DesignWorkbench() {
  return <DesignWorkbenchPage lang="zh" initialMode="home" />;
}
