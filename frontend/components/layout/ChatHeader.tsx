"use client";

import { useDict, useLocale } from "../../lib/i18n-context";
import Link from "next/link";
import { SUPPORTED_LOCALES } from "../../lib/locale";

const LOCALE_LABELS: Record<(typeof SUPPORTED_LOCALES)[number], string> = {
  ja: "日本語",
  zh: "中文",
  en: "EN",
};

export default function ChatHeader() {
  const { header: t } = useDict();
  const locale = useLocale();
  const currentLocale = SUPPORTED_LOCALES.includes(locale as (typeof SUPPORTED_LOCALES)[number])
    ? (locale as (typeof SUPPORTED_LOCALES)[number])
    : "ja";

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-6">
      <div>
        <h1 className="font-[family-name:var(--app-font-display)] text-sm font-semibold text-[var(--color-fg)]">{t.title}</h1>
        <p className="text-xs text-[var(--color-muted-fg)]">{t.subtitle}</p>
      </div>
      <div className="flex items-center gap-1.5">
        {SUPPORTED_LOCALES.map((lang) => (
          <Link
            key={lang}
            href={`/${lang}/`}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-medium transition",
              lang === currentLocale
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-secondary)]",
            ].join(" ")}
          >
            {LOCALE_LABELS[lang]}
          </Link>
        ))}
      </div>
    </header>
  );
}
