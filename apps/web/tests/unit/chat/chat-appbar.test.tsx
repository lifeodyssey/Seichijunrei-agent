/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatAppBar } from "../../../src/features/chat/components/ChatAppBar";
import { ChatReturnTargetProvider } from "../../../src/features/chat/ChatReturnTarget";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import type { AuthStatus } from "../../../src/lib/auth/session";
import { AppRouterContext } from "../_router";

const ja = chatDictFor("ja");

afterEach(cleanup);

function renderAppBar(status: AuthStatus) {
  render(
    <AppRouterContext>
      <LocaleProvider>
        <ChatAppBar dict={ja} status={status} />
      </LocaleProvider>
    </AppRouterContext>,
  );
}

describe("mobile top bar brand lockup", () => {
  it("renders the torii beside the outlined wordmark", () => {
    renderAppBar("authenticated");
    const torii = screen.getAllByAltText("").find((image) => image.getAttribute("src") === "/images/landing/torii.svg");
    expect(torii?.getAttribute("width")).toBe("26");
    expect(screen.getByText(ja.appbar.brand)).toBeTruthy();
  });

  it.each(LOCALES)("shows the %s wordmark", (locale) => {
    const dict = chatDictFor(locale);
    render(
      <AppRouterContext>
        <LocaleProvider>
          <ChatAppBar dict={dict} status="anonymous" />
        </LocaleProvider>
      </AppRouterContext>,
    );
    expect(screen.getByText(dict.appbar.brand)).toBeTruthy();
  });

  it("keeps the English mark the latin Animichi, never a romanized 圣地巡礼", () => {
    expect(chatDictFor("en").appbar.brand).toBe("Animichi");
  });
});

describe("mobile top bar actions", () => {
  it("makes the plus control a link to /chat labelled as a new journey", () => {
    renderAppBar("anonymous");
    const link = screen.getByRole("link", { name: ja.newJourney });
    expect(link.getAttribute("href")).toBe("/chat");
  });

  it("keeps the settings deep link on the bar", () => {
    renderAppBar("anonymous");
    expect(screen.getByRole("link", { name: ja.appbar.settings }).getAttribute("href")).toBe("/settings");
  });
});

describe("chat appbar settings link", () => {
  it("points at the settings route without a conversation to carry", () => {
    renderAppBar("anonymous");
    expect(screen.getByRole("link", { name: ja.appbar.settings }).getAttribute("href")).toBe("/settings");
  });

  it("carries the live conversation so settings can send the visitor back", () => {
    render(
      <AppRouterContext>
        <ChatReturnTargetProvider sessionIdOf={() => "sess-1337"}>
          <LocaleProvider><ChatAppBar dict={ja} status="anonymous" /></LocaleProvider>
        </ChatReturnTargetProvider>
      </AppRouterContext>,
    );
    expect(screen.getByRole("link", { name: ja.appbar.settings }).getAttribute("href")).toBe("/settings?session=sess-1337");
  });
});

describe("mobile top bar identity slot", () => {
  it("shows the login entry and never a stand-in avatar for an anonymous visitor", () => {
    renderAppBar("anonymous");
    expect(screen.getByRole("button", { name: ja.appbar.login })).toBeTruthy();
  });

  it("renders no login affordance while auth is pending or signed in", () => {
    renderAppBar("pending");
    expect(screen.queryByRole("button", { name: ja.appbar.login })).toBeNull();
    cleanup();
    renderAppBar("authenticated");
    expect(screen.queryByRole("button", { name: ja.appbar.login })).toBeNull();
  });

  it("opens and closes the login dialog from the login entry", () => {
    renderAppBar("anonymous");
    fireEvent.click(screen.getByRole("button", { name: ja.appbar.login }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
