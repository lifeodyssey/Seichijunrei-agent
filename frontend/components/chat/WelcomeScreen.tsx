"use client";

import { useEffect, useState } from "react";
import type { Dict, Locale } from "../../lib/i18n";
import { fetchPopularBangumi, type PopularBangumiEntry } from "../../lib/api";
import { popularSpotQuery } from "../../lib/quick-actions";
import { ANIME_COVERS } from "../../lib/mock-data";

interface WelcomeScreenProps {
  onSend: (text: string) => void;
  dict: Dict;
  locale: Locale;
}

/**
 * Welcome screen — Variant A: full-screen hero background with centered input.
 *
 * The hero image IS the page. Logo, title, input, chips, and covers
 * float on top of the darkened background. Single viewport, no scroll.
 * Natural transition to results: hero fades, content appears.
 */
export default function WelcomeScreen({ onSend, dict, locale }: WelcomeScreenProps) {
  const ws = dict.welcome_screen;
  const [popular, setPopular] = useState<PopularBangumiEntry[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchPopularBangumi()
      .then(setPopular)
      .catch(() => setPopular([]));
  }, []);

  const fallbackCovers: PopularBangumiEntry[] = [
    { bangumi_id: "115908", title: "響け！ユーフォニアム", cover_url: ANIME_COVERS["115908"] },
    { bangumi_id: "160209", title: "君の名は。", cover_url: ANIME_COVERS["160209"] },
    { bangumi_id: "269235", title: "天気の子", cover_url: ANIME_COVERS["269235"] },
    { bangumi_id: "485", title: "涼宮ハルヒの憂鬱", cover_url: ANIME_COVERS["485"] },
    { bangumi_id: "1424", title: "けいおん！", cover_url: ANIME_COVERS["1424"] },
    { bangumi_id: "362577", title: "すずめの戸締まり", cover_url: ANIME_COVERS["362577"] },
  ];

  const covers = popular.length > 0 ? popular.slice(0, 6) : fallbackCovers;

  const chipData = [
    {
      icon: "🔍",
      label: locale === "zh" ? "搜索取景地" : locale === "en" ? "Search spots" : "聖地を検索",
      query: locale === "zh" ? "你的名字的取景地在哪" : locale === "en" ? "Show me anime spots for Your Name" : "君の名は の聖地を教えて",
    },
    {
      icon: "📍",
      label: locale === "zh" ? "我附近有什么" : locale === "en" ? "Near me" : "近くの聖地",
      query: locale === "zh" ? "告诉我附近的动漫取景地" : locale === "en" ? "Find anime spots near me" : "現在地の近くにある聖地を教えて",
    },
    {
      icon: "🗺️",
      label: locale === "zh" ? "规划路线" : locale === "en" ? "Plan route" : "ルート計画",
      query: locale === "zh" ? "帮我规划吹响上低音号的巡礼路线" : locale === "en" ? "Plan a pilgrimage route for Sound! Euphonium" : "響け！ユーフォニアム の聖地を巡るルートを作って",
    },
  ];

  const placeholder =
    locale === "zh"
      ? "输入动漫名称，或描述你的巡礼计划…"
      : locale === "en"
        ? "Type an anime name, or describe your trip…"
        : "アニメ名を入力、または旅の計画を…";

  function handleSubmit() {
    if (!query.trim()) return;
    onSend(query);
    setQuery("");
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* ── Full-screen hero background ──────────────────────── */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://image.anitabi.cn/points/115908/qys7fu.jpg"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
        style={{ filter: "brightness(0.5)" }}
        width={1200}
        height={800}
      />
      {/* Gradient overlay — darker at bottom for text readability */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, oklch(20% 0.02 238 / 0.2) 0%, oklch(20% 0.02 238 / 0.5) 40%, oklch(20% 0.02 238 / 0.75) 100%)",
        }}
      />

      {/* ── Content overlay — centered vertically ────────────── */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        {/* Logo */}
        <div className="mb-2">
          <svg viewBox="0 0 72 72" width="36" height="36" fill="none" className="mx-auto" aria-hidden>
            <rect x="12" y="16" width="48" height="5" rx="2.5" fill="white" />
            <rect x="8" y="14" width="56" height="3" rx="1.5" fill="white" />
            <rect x="16" y="21" width="5" height="35" rx="1" fill="white" />
            <rect x="51" y="21" width="5" height="35" rx="1" fill="white" />
            <rect x="12" y="30" width="48" height="3" rx="1.5" fill="white" opacity=".5" />
          </svg>
        </div>

        {/* Title */}
        <h1
          className="mb-1 text-center text-[32px] font-bold leading-tight text-white"
          style={{
            fontFamily: "var(--app-font-display)",
            textShadow: "0 2px 16px oklch(20% 0.02 238 / 0.4)",
          }}
        >
          聖地巡礼
        </h1>

        {/* Tagline */}
        <p className="mb-6 max-w-[36ch] text-center text-sm text-white/80">
          {ws.tagline}
        </p>

        {/* ── Input — the visual hero ────────────────────────── */}
        <div className="mb-4 flex w-full max-w-[480px] items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder={placeholder}
            className="h-[52px] flex-1 rounded-[26px] border-none bg-white/90 px-5 text-[15px] text-[var(--fg)] shadow-lg outline-none backdrop-blur-sm placeholder:text-[var(--muted-fg)] focus:bg-white"
            style={{
              boxShadow: "0 4px 24px oklch(20% 0.02 238 / 0.2)",
              transition: "background 0.15s, box-shadow 0.15s",
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!query.trim()}
            aria-label={dict.chat.send}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-lg transition-opacity duration-150 disabled:opacity-40"
            style={{ background: "var(--color-primary)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        {/* ── Suggestion chips ───────────────────────────────── */}
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {chipData.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => onSend(chip.query)}
              className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[13px] text-white/90 backdrop-blur-sm transition-colors duration-150 hover:bg-white/20"
            >
              <span aria-hidden>{chip.icon}</span>
              {chip.label}
            </button>
          ))}
        </div>

        {/* ── Anime covers — bottom row ──────────────────────── */}
        <div className="flex gap-3">
          {covers.map((item, idx) => (
            <button
              key={`${item.bangumi_id}-${idx}`}
              type="button"
              onClick={() => onSend(popularSpotQuery(item.title, locale))}
              className="group flex shrink-0 flex-col items-center gap-1"
              title={item.title}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.cover_url ?? ""}
                alt={item.title}
                width={52}
                height={72}
                loading="lazy"
                className="h-[72px] w-[52px] rounded-[var(--r-md)] border border-white/15 object-cover transition-transform duration-150 group-hover:scale-110"
              />
              <span className="max-w-[52px] truncate text-[10px] text-white/50 group-hover:text-white/80">
                {item.title.length > 5 ? `${item.title.slice(0, 4)}…` : item.title}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
