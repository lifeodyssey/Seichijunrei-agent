/**
 * @vitest-environment jsdom
 *
 * P1 regression (issue #1009): `useTheme` must not read storage and write the
 * captured theme in the same `[theme]` effect. That design made a stored night
 * preference alternate with the rendered day default and loop forever. Storage
 * is now read only on mount/hydration, so a stored preference applies without
 * an oscillating write and a later toggle is never re-read back.
 *
 * Night mode is paused (2026-09, night palette undecided): adoption accepts
 * only "day", so a stale stored "night" is ignored and healed to "day" on
 * mount instead of trapping the user in a theme with no switch UI.
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSwitch } from "../../src/components/settings/ThemeSwitch";
import { THEME_STORAGE_KEY } from "../../src/features/config/lib/theme-storage";
import { renderWithLocale, setLanguages } from "./_i18n";

/**
 * The suite pins a deterministic fixed clock (issue #1009 review): the
 * hydration barrier and the toggle reads never depend on wall-clock time.
 */
const FIXED_NOW = 1_750_000_000_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  setLanguages(["ja-JP"]);
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  delete document.documentElement.dataset.theme;
});

/** The panel switch; `aria-checked` is its night signal. */
function themeSwitch(): HTMLElement {
  return screen.getByRole("switch");
}

describe("useTheme hydration (issue #1009 P1 regression)", () => {
  it("ignores stored night while paused, settles on day, and heals storage", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "night");
    renderWithLocale(<ThemeSwitch />);
    expect(themeSwitch().getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("day");
  });

  it("applies a later toggle without rereading the stored preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "night");
    renderWithLocale(<ThemeSwitch />);
    act(() => { themeSwitch().click(); });
    expect(themeSwitch().getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("night");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("night");
  });
});
