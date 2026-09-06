/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import { healthzDownHandler, healthzOkHandler, chatStreamHandler } from "../../msw/chat-handlers";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

describe("A1 cold start", () => {
  it("renders the frozen heading, the three entry doors, and an auto-focused input", async () => {
    setLanguages(["ja"]);
    renderChatPage();
    expect(await screen.findByRole("heading", { level: 1, name: ja.coldStartHeading })).toBeTruthy();
    expect(screen.getByText(ja.coldStartSub)).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.entryAnimeTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.entryCityTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.entryChatTitle })).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.sampleLink })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it.each(["zh", "en"] as const)("greets in %s per locale", async (locale) => {
    setLanguages([locale]);
    renderChatPage();
    const dict = chatDictFor(locale);
    expect(await screen.findByRole("heading", { level: 1, name: dict.coldStartHeading })).toBeTruthy();
    expect(screen.getByText(dict.coldStartSub)).toBeTruthy();
  });

  it("sends an entry prompt through the composer path when a door is clicked", async () => {
    setLanguages(["ja"]);
    server.use(chatStreamHandler("search"));
    renderChatPage();
    fireEvent.click(await screen.findByRole("button", { name: ja.entryChatTitle }));
    expect(await screen.findByText(ja.entryChatPrompt)).toBeTruthy();
  });
});

describe("A2b route reference degrade", () => {
  it("falls back to the A1 cold start when the referenced route is gone", async () => {
    setLanguages(["ja"]);
    renderChatPage(chatSearch({ route: "r-deleted" }));
    expect(await screen.findByRole("heading", { level: 1, name: ja.coldStartHeading })).toBeTruthy();
    expect(screen.queryByText(/引用中/)).toBeNull();
  });
});

describe("A5 backend unreachable", () => {
  it("shows the error banner, disables input, and retry restores A1", async () => {
    setLanguages(["ja"]);
    server.use(healthzDownHandler);
    renderChatPage(chatSearch(), false);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain(ja.errorBanner);
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
    server.use(healthzOkHandler);
    fireEvent.click(screen.getByRole("button", { name: ja.retry }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
  });
});
