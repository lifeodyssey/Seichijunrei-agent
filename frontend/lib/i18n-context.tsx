"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Dict, Locale } from "./i18n";
import { DEFAULT_LOCALE, detectLocale, loadDict } from "./i18n";
import defaultDict from "./dictionaries/ja.json";

interface I18nCtx {
  dict: Dict;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nCtx>({
  dict: defaultDict as Dict,
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // detectLocale() runs once via the state initializer — stable across renders.
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());
  const [dict, setDict] = useState<Dict>(defaultDict as Dict);

  // Load the detected locale's dictionary on mount. Adding `locale` to deps is
  // safe: setLocale already handles subsequent changes, and re-loading is idempotent.
  useEffect(() => {
    document.documentElement.lang = locale;
    if (locale !== DEFAULT_LOCALE) {
      loadDict(locale).then((d) => setDict(d as Dict));
    }
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    document.documentElement.lang = newLocale;
    loadDict(newLocale).then((d) => setDict(d as Dict));
  }, []);

  return (
    <I18nContext.Provider value={{ dict, locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useDict(): Dict {
  return useContext(I18nContext).dict;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export function useSetLocale(): (locale: Locale) => void {
  return useContext(I18nContext).setLocale;
}
