/**
 * Unit tests for detectLocale() in lib/i18n.ts
 *
 * AC coverage:
 * - navigator.language = "ja" → locale resolves to "ja"
 * - navigator.language = "zh-CN" → locale resolves to "zh"
 * - navigator.languages is empty → defaults to "ja"
 * - Unknown locale "fr" → falls back to "ja"
 * - English locale auto-detected when navigator.language = "en-US"
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { detectLocale } from "../i18n";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockNavigatorLanguages(languages: readonly string[]): void {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(
    languages as string[] as unknown as readonly string[],
  );
}

describe("detectLocale()", () => {
  it("resolves to 'ja' when navigator.language is 'ja'", () => {
    mockNavigatorLanguages(["ja"]);
    expect(detectLocale()).toBe("ja");
  });

  it("resolves to 'zh' when navigator.language is 'zh-CN'", () => {
    mockNavigatorLanguages(["zh-CN"]);
    expect(detectLocale()).toBe("zh");
  });

  it("resolves to 'zh' for any zh- variant", () => {
    mockNavigatorLanguages(["zh-TW"]);
    expect(detectLocale()).toBe("zh");
  });

  it("defaults to 'ja' when navigator.languages is empty", () => {
    mockNavigatorLanguages([]);
    expect(detectLocale()).toBe("ja");
  });

  it("falls back to 'ja' for unknown locale 'fr'", () => {
    mockNavigatorLanguages(["fr"]);
    expect(detectLocale()).toBe("ja");
  });

  it("falls back to 'ja' for unknown locale 'de-DE'", () => {
    mockNavigatorLanguages(["de-DE"]);
    expect(detectLocale()).toBe("ja");
  });

  it("resolves to 'en' when navigator.language is 'en-US'", () => {
    mockNavigatorLanguages(["en-US"]);
    expect(detectLocale()).toBe("en");
  });

  it("resolves to 'en' when navigator.language is 'en-GB'", () => {
    mockNavigatorLanguages(["en-GB"]);
    expect(detectLocale()).toBe("en");
  });

  it("picks first matching locale from navigator.languages list", () => {
    // zh appears before en — should resolve to zh
    mockNavigatorLanguages(["zh-CN", "en-US", "ja"]);
    expect(detectLocale()).toBe("zh");
  });

  it("skips unknown locales and picks first known one", () => {
    // fr and de are unknown; ja is the first known one
    mockNavigatorLanguages(["fr", "de", "ja"]);
    expect(detectLocale()).toBe("ja");
  });
});
