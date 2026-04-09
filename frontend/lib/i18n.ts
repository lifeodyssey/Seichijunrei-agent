export const LOCALES = ["ja", "zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ja";

/** Human-readable locale labels — single source of truth for all switchers. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  zh: "中文",
  en: "EN",
};

export function detectLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  for (const lang of navigator.languages ?? []) {
    const code = lang.toLowerCase();
    if (code.startsWith("zh")) return "zh";
    if (code.startsWith("ja")) return "ja";
    if (code.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

export async function loadDict(locale: Locale) {
  const loaders: Record<Locale, () => Promise<{ default: Dict }>> = {
    ja: () => import("./dictionaries/ja.json"),
    zh: () => import("./dictionaries/zh.json"),
    en: () => import("./dictionaries/en.json"),
  };
  return (await loaders[locale]()).default;
}

import type jaDict from "./dictionaries/ja.json";
export type Dict = typeof jaDict;
