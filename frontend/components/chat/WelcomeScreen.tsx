"use client";

import { useEffect, useState } from "react";
import type { Dict, Locale } from "../../lib/i18n";
import { fetchPopularBangumi, type PopularBangumiEntry } from "../../lib/api";

interface WelcomeScreenProps {
  onSend: (text: string) => void;
  dict: Dict;
  locale: Locale;
}

interface QuickAction {
  icon: string;
  label: string;
  desc: string;
  query: string;
}

const QUICK_ACTION_QUERIES: Record<Locale, [string, string, string]> = {
  ja: [
    "君の名は の聖地を教えて",
    "現在地の近くにある聖地を教えて",
    "響け！ユーフォニアム の聖地を巡るルートを作って",
  ],
  zh: [
    "你的名字的取景地在哪",
    "告诉我附近的动漫取景地",
    "帮我规划吹响上低音号的巡礼路线",
  ],
  en: [
    "Show me anime spots for Your Name",
    "Find anime spots near me",
    "Plan a pilgrimage route for Sound! Euphonium",
  ],
};

function buildQuickActions(ws: Dict["welcome_screen"], locale: Locale): QuickAction[] {
  const q = QUICK_ACTION_QUERIES[locale];
  return [
    { icon: "🔍", label: ws.action_search, desc: ws.action_search_desc, query: q[0] },
    { icon: "📍", label: ws.action_nearby, desc: ws.action_nearby_desc, query: q[1] },
    { icon: "🗺", label: ws.action_route, desc: ws.action_route_desc, query: q[2] },
  ];
}

export default function WelcomeScreen({ onSend, dict, locale }: WelcomeScreenProps) {
  const ws = dict.welcome_screen;
  const [popular, setPopular] = useState<PopularBangumiEntry[]>([]);

  useEffect(() => {
    fetchPopularBangumi()
      .then(setPopular)
      .catch(() => setPopular([]));
  }, []);

  const quickActions = buildQuickActions(ws, locale);

  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {/* Logo */}
      <div
        className="mb-4 text-[40px] text-[var(--color-fg)] leading-none"
        style={{ fontFamily: "var(--app-font-display)" }}
      >
        聖地巡礼
      </div>

      {/* Tagline */}
      <p
        className="mb-8 max-w-xs text-sm text-[var(--color-muted-fg)]"
        style={{ fontFamily: "var(--app-font-body)" }}
      >
        {ws.tagline}
      </p>

      {/* 3 Quick-action cards */}
      <div className="mb-8 grid w-full max-w-sm gap-3">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => onSend(action.query)}
            className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-card)]"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <span className="mt-0.5 text-lg leading-none" aria-hidden="true">
              {action.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--color-fg)]">
                {action.label}
              </span>
              <span className="block text-xs text-[var(--color-muted-fg)]">
                {action.desc}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* Popular anime chips — horizontal scroll row */}
      {popular.length > 0 && (
        <div className="w-full max-w-sm">
          <p className="mb-2 text-xs font-medium text-[var(--color-muted-fg)]">
            {ws.popular_label}
          </p>
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {popular.map((item, idx) => (
              <button
                key={`${item.bangumi_id}-${idx}`}
                type="button"
                onClick={() => onSend(
                  locale === "ja"
                    ? `${item.title} の聖地を教えて`
                    : locale === "zh"
                    ? `${item.title}的取景地在哪`
                    : `Show me pilgrimage spots for ${item.title}`,
                )}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs text-[var(--color-fg)] transition-colors hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)]"
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                {item.cover_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.cover_url}
                    alt=""
                    aria-hidden="true"
                    className="h-6 w-6 rounded-full object-cover"
                  />
                )}
                <span>{item.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
