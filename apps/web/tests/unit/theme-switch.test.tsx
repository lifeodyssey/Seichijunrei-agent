/**
 * @vitest-environment jsdom
 */
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeSwitch } from "../../src/components/settings/ThemeSwitch";
import { renderWithLocale, setLanguages } from "./_i18n";

beforeEach(() => {
  setLanguages(["ja-JP"]);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

/** The panel's day/night switch, found the way a screen reader finds it. */
function themeSwitch(): HTMLElement {
  return screen.getByRole("switch");
}

describe("ThemeSwitch — ON is night, OFF is the day default", () => {
  it("starts OFF, showing day, and persists that default", () => {
    renderWithLocale(<ThemeSwitch />);
    expect(themeSwitch().getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
  });

  it("keeps one stable accessible name in both positions (WCAG 4.1.2)", () => {
    renderWithLocale(<ThemeSwitch />);
    const named = screen.getByRole("switch", { name: "夜間モード" });
    act(() => { named.click(); });
    expect(screen.getByRole("switch", { name: "夜間モード" })).toBe(named);
  });

  it("turns ON into night, writing the document theme and storage", () => {
    renderWithLocale(<ThemeSwitch />);
    act(() => { themeSwitch().click(); });
    expect(themeSwitch().getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("night");
    expect(window.localStorage.getItem("animichi-theme")).toBe("night");
  });

  it("turns OFF back to day on a second press", () => {
    renderWithLocale(<ThemeSwitch />);
    act(() => { themeSwitch().click(); });
    act(() => { themeSwitch().click(); });
    expect(themeSwitch().getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("day");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
  });

  it("ignores a stored night preference while night mode is paused (2026-09)", () => {
    window.localStorage.setItem("animichi-theme", "night");
    renderWithLocale(<ThemeSwitch />);
    expect(themeSwitch().getAttribute("aria-checked")).toBe("false");
    expect(window.localStorage.getItem("animichi-theme")).toBe("day");
  });

  it("ignores an invalid stored value and stays on day", () => {
    window.localStorage.setItem("animichi-theme", "sepia");
    renderWithLocale(<ThemeSwitch />);
    expect(themeSwitch().getAttribute("aria-checked")).toBe("false");
  });
});
