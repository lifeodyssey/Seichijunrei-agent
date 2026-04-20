import type { Locale } from "./i18n";

/**
 * Locale-specific query strings for quick-action chips and welcome cards.
 * Index 0: search by anime title
 * Index 1: find nearby spots
 * Index 2: plan a route
 */
export const QUICK_ACTION_QUERIES: Record<Locale, [string, string, string]> = {
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

/** Convenience accessor — returns query string at `index` for the given locale. */
export function getQuickActionQuery(locale: Locale, index: 0 | 1 | 2): string {
  return QUICK_ACTION_QUERIES[locale][index];
}

/** Chat-input bar quick actions: route and popular-spots short queries. */
export const CHAT_INPUT_QUERIES: Record<Locale, { route: string; popular: string }> = {
  ja: {
    route: "ルートを計画して",
    popular: "人気の聖地を教えて",
  },
  zh: {
    route: "帮我规划路线",
    popular: "有哪些热门动漫取景地",
  },
  en: {
    route: "Plan a route for me",
    popular: "Show me popular anime spots",
  },
};

/** Build the query string for a popular-spot chip given an anime title and locale. */
export function popularSpotQuery(title: string, locale: Locale): string {
  const queries: Record<Locale, string> = {
    ja: `${title} の聖地を教えて`,
    zh: `${title}的取景地在哪`,
    en: `Show me pilgrimage spots for ${title}`,
  };
  return queries[locale];
}
