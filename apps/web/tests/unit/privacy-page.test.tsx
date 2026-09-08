/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { PrivacyPolicy } from "../../src/components/legal/PrivacyPolicy";
import { Route as PrivacyRoute } from "../../src/routes/privacy";
import { dictFor } from "../../src/i18n/dictionaries";
import { renderWithLocale, setLanguages } from "./_i18n";
import { AppRouterContext } from "./_router";
import globalsCss from "../../src/styles/globals.css?raw";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(cleanup);

describe("PrivacyPolicy", () => {
  it("renders the Japanese notice with a same-origin home link and GitHub contact", () => {
    renderWithLocale(<PrivacyPolicy />);
    expect(screen.getByRole("heading", { name: dictFor("ja").privacy.title })).toBeTruthy();
    expect(screen.getByText(dictFor("ja").privacy.version)).toBeTruthy();
    expect(screen.getByText(dictFor("ja").privacy.security_body)).toBeTruthy();
    expect(screen.getByText(dictFor("ja").privacy.evaluation_body)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Animichiに戻る/ }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: dictFor("ja").privacy.contact_link }).getAttribute("href")).toContain("github.com");
  });

  it("is written in semantic utilities, with no page-private stylesheet left behind", () => {
    renderWithLocale(<PrivacyPolicy />);
    const main = screen.getByRole("main");
    expect(main.className).toContain("mx-auto");
    expect(main.className).not.toContain("privacy-page");
    expect(globalsCss).not.toContain("privacy.css");
  });

  /**
   * The migration off privacy.css kept its one-off pixel values on purpose, to
   * prove the move changed nothing. The two that the shared spacing scale can
   * already say exactly — 38px and 42px are 9.5 and 10.5 steps of the 0.25rem
   * scale this file already spends as gap-6.5 and pb-18 — now say it that way.
   */
  it("spaces the page off the shared scale rather than one-off pixel margins", () => {
    renderWithLocale(<PrivacyPolicy />);
    expect(screen.getByRole("complementary").className).toContain("mt-9.5");
    expect(screen.getByRole("main").innerHTML).toContain("mb-10.5");
    expect(screen.getByRole("main").innerHTML).not.toMatch(/\bm[bt]-\[/u);
  });

  it("renders every visible policy heading and intro in Chinese without Japanese fallback copy", () => {
    setLanguages(["zh-CN"]);
    renderWithLocale(<PrivacyPolicy />);
    expect(screen.getByRole("heading", { name: dictFor("zh").privacy.title })).toBeTruthy();
    expect(screen.getByText(dictFor("zh").privacy.intro)).toBeTruthy();
    expect(screen.getByText(dictFor("zh").privacy.improvement_body)).toBeTruthy();
    expect(screen.queryByText(dictFor("ja").privacy.intro)).toBeNull();
  });

  it("negotiates the browser locale through the route's own provider", () => {
    setLanguages(["en-US"]);
    const renderRoute = PrivacyRoute.options.component as () => ReactNode;
    render(<AppRouterContext>{renderRoute()}</AppRouterContext>);
    expect(screen.getByRole("heading", { name: dictFor("en").privacy.title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: dictFor("ja").privacy.title })).toBeNull();
  });

  it.each(["ja", "zh", "en"] as const)("states the evaluation safeguards in %s", (locale) => {
    const copy = dictFor(locale).privacy;
    expect(copy.version).toContain("2026-08-02");
    expect(copy.improvement_body).toMatch(/365|365日|365 天/);
    expect(copy.security_body).toContain("AES-256-GCM");
    expect(copy.security_body).toMatch(/API|Authorization|Cookie/);
    expect(copy.evaluation_body).toMatch(/feedback|フィードバック|反馈/);
    expect(copy.evaluation_body).toMatch(/consent|同意/);
  });
});
