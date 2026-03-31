export const SUPPORTED_LOCALES = ["ja", "zh"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "ja";

export function pickPreferredLocale(
  languages: readonly string[] | undefined,
): SupportedLocale {
  for (const language of languages ?? []) {
    const normalized = language.toLowerCase();
    if (normalized.startsWith("zh")) return "zh";
    if (normalized.startsWith("ja")) return "ja";
  }

  return DEFAULT_LOCALE;
}
