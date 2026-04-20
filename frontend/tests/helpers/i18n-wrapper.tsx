import type { ReactNode } from "react";
import defaultDict from "@/lib/dictionaries/ja.json";
import { vi } from "vitest";

// Mock i18n-context so components using useDict() get the default (ja) dictionary.
vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
  useLocale: () => "ja" as const,
  useSetLocale: () => () => {},
  LocaleProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

/** Renders children inside a mocked i18n context providing Japanese dictionary. */
export function I18nTestWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
