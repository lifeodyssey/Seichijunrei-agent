/**
 * @vitest-environment jsdom
 */
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { server } from "../../msw/node";
import {
  conversationMessagesErrorHandler,
  conversationMessagesHandler,
} from "../../msw/chat-handlers";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");

const HISTORY = [
  { role: "user", content: "ユーフォの聖地" },
  {
    role: "assistant",
    content: "宇治の聖地を2件、徒歩ルートにまとめました。",
    response_data: { intent: "plan_route", success: true },
  },
] as const;

beforeEach(() => {
  setLanguages(["ja"]);
});

describe("A3 history restoration", () => {
  it("renders the full historical message list with a collapsed footprint row", async () => {
    server.use(conversationMessagesHandler("s-1", [...HISTORY]));
    renderChatPage(chatSearch({ session: "s-1" }));
    expect(await screen.findByText("ユーフォの聖地")).toBeTruthy();
    expect(screen.getByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeTruthy();
    const footprint = document.querySelector(".chat-footprint");
    expect(footprint?.getAttribute("data-intent")).toBe("plan_route");
    expect(screen.queryByRole("heading", { level: 1, name: ja.coldStartHeading })).toBeNull();
  });

  it("does not auto-send ?q= while restoring a session", async () => {
    server.use(conversationMessagesHandler("s-1", [...HISTORY]));
    renderChatPage(chatSearch({ session: "s-1", q: "別の作品" }));
    await screen.findByText("ユーフォの聖地");
    expect(screen.queryByText("別の作品")).toBeNull();
  });
});

describe("A3 history failure", () => {
  it.each([401, 404, 500])(
    "surfaces a %d as an error state instead of a blank writable session",
    async (status) => {
      server.use(conversationMessagesErrorHandler("s-1", status));
      renderChatPage(chatSearch({ session: "s-1" }));
      const banner = await screen.findByRole("alert");
      expect(banner.textContent).toContain(ja.historyError);
      expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
      expect(screen.queryByRole("heading", { level: 1, name: ja.coldStartHeading })).toBeNull();
    },
  );

  it("re-enables the composer once history restoration succeeds", async () => {
    server.use(conversationMessagesHandler("s-1", [...HISTORY]));
    renderChatPage(chatSearch({ session: "s-1" }));
    await screen.findByText("ユーフォの聖地");
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
  });
});
