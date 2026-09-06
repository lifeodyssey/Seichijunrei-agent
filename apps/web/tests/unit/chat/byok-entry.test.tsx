/**
 * @vitest-environment jsdom
 */
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { parseChatSearch } from "../../../src/features/chat/search";
import { setLanguages } from "../_i18n";
import { renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

function renderSettingsLinks(): HTMLAnchorElement[] {
  setLanguages(["ja"]);
  renderChatPage();
  return screen.getAllByRole<HTMLAnchorElement>("link", { name: ja.appbar.settings });
}

describe("settings entry point", () => {
  it("is ordinary navigation to the dedicated page, wherever the chrome renders it", () => {
    const links = renderSettingsLinks();
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.getAttribute("href") === "/settings")).toBe(true);
    expect(links.every((link) => link.getAttribute("aria-expanded") === null)).toBe(true);
    expect(links.every((link) => link.closest("form") === null)).toBe(true);
  });

  it("occupies the rightmost slot of the mobile bar's action cluster", async () => {
    const links = renderSettingsLinks();
    /* Anonymous mounts a Log in in BOTH the mobile bar and the desktop
     * sidebar — jsdom applies no media queries, so the settle-wait counts
     * both rather than expecting a single match. */
    await waitFor(() => { expect(screen.getAllByRole("button", { name: ja.appbar.login }).length).toBe(2); });
    const barLink = links.find((link) => link.closest("header") !== null);
    expect(barLink?.parentElement?.lastElementChild).toBe(barLink);
  });

  it("does not mount legacy drawer or BYOK content inside chat", () => {
    renderSettingsLinks();
    expect(document.querySelector("[data-animal-drawer-portal]")).toBeNull();
    expect(screen.queryByText(ja.byok.anonymousTeaser)).toBeNull();
  });
});

describe("legacy chat settings search is gone", () => {
  it("drops the old settings parameter instead of keeping compatibility state", () => {
    expect(parseChatSearch({ settings: "byok", session: "s1" })).toEqual({ q: undefined, route: undefined, session: "s1" });
  });
});
