import "server-only";

const dictionaries = {
  ja: () => import("./dictionaries/ja.json").then((m) => m.default),
  zh: () => import("./dictionaries/zh.json").then((m) => m.default),
  en: () => import("./dictionaries/en.json").then((m) => m.default),
};

export type Locale = keyof typeof dictionaries;
export type Dict = Awaited<ReturnType<(typeof dictionaries)[Locale]>>;

export const locales: Locale[] = ["ja", "zh", "en"];
export const defaultLocale: Locale = "ja";

export const hasLocale = (locale: string): locale is Locale =>
  locale in dictionaries;

export const getDictionary = async (locale: Locale) => dictionaries[locale]();
