"use client";

import { createContext, useContext } from "react";
import type { Dict, Locale } from "../app/[lang]/dictionaries";

interface I18n {
  dict: Dict;
  locale: Locale;
}

const I18nContext = createContext<I18n | null>(null);

export function DictProvider({
  dict,
  locale,
  children,
}: {
  dict: Dict;
  locale: Locale;
  children: React.ReactNode;
}) {
  return <I18nContext.Provider value={{ dict, locale }}>{children}</I18nContext.Provider>;
}

export function useDict(): Dict {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useDict must be used within DictProvider");
  return ctx.dict;
}

export function useLocale(): Locale {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useLocale must be used within DictProvider");
  return ctx.locale;
}
