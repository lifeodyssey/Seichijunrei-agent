"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Dict, Locale } from "./i18n";
import { DEFAULT_LOCALE, detectLocale, loadDict, persistLocale } from "./i18n";
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
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [dict, setDict] = useState<Dict>(defaultDict as Dict);

  useEffect(() => {
    const detected = detectLocale();
    document.documentElement.lang = detected;
    if (detected === DEFAULT_LOCALE) {
      setLocaleState(detected);
      return;
    }
    setLocaleState(detected);
    loadDict(detected).then((d) => setDict(d as Dict));
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    persistLocale(newLocale);
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
