export const SUPPORTED_LOCALES = ["ja", "zh", "en"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "ja";

export function pickPreferredLocale(
  languages: readonly string[] | undefined,
): SupportedLocale {
  for (const language of languages ?? []) {
    const normalized = language.toLowerCase();
    if (normalized.startsWith("zh")) return "zh";
    if (normalized.startsWith("ja")) return "ja";
    if (normalized.startsWith("en")) return "en";
  }

  return DEFAULT_LOCALE;
}
