/**
 * @vitest-environment jsdom
 */
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { healthzDownHandler } from "../../msw/chat-handlers";
import { server } from "../../msw/node";
import { setLanguages } from "../_i18n";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

beforeEach(() => {
  setLanguages(["ja"]);
});

/** The mobile top bar — the first header on the page, where the brand lives
 * above the notices so an outage never moves it nor reads as chrome. */
function renderedAppBar(): HTMLElement | null {
  const brands = screen.getAllByText(ja.appbar.brand);
  return brands[0]?.closest("header") ?? null;
}

describe("the chat page's own chrome", () => {
  it("mounts the mobile bar with a new-journey link to /chat", () => {
    renderChatPage();
    const links = screen.getAllByRole("link", { name: ja.newJourney });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute("href")).toBe("/chat");
  });

  it("keeps the mobile bar above the A5 banner and outside it, so an outage never moves the brand nor reads as chrome", async () => {
    server.use(healthzDownHandler);
    renderChatPage(chatSearch(), false);
    const banner = await screen.findByRole("alert");
    expect(renderedAppBar()?.compareDocumentPosition(banner)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
