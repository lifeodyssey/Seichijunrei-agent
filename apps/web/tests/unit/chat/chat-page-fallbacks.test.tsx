/**
 * @vitest-environment jsdom
 */
import { http } from "msw";
import { completedNativeWatch } from "./_native-watch";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import {
  chatBudgetExhaustedHandler,
  chatCodelessErrorHandler,
  chatHttpErrorHandler,
  chatStreamDropHandler,
  chatStreamImmediateDropHandler,
  conversationMessagesHandler,
} from "../../msw/chat-handlers";
import { server } from "../../msw/node";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");
const states = ja.errorStates;

beforeEach(() => {
  setLanguages(["ja"]);
});

function sendText(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: ja.send }));
}

const FINAL_ANSWER = "宇治の聖地を2件、徒歩ルートにまとめました。";

async function completedSnapshot(seen: string[] = []) {
  const native = await completedNativeWatch(FINAL_ANSWER, "s-1");
  onTestFinished(native.close);
  server.use(http.get("*/v1/conversations/s-1/stream", ({ request }) => {
    seen.push(request.url);
    return native.response();
  }));
}

describe("D4 mid-stream interruption", () => {
  it("shows the inline retry strip and preserves the already-rendered content", async () => {
    server.use(chatStreamDropHandler("search"));
    renderChatPage();
    sendText("ユーフォ");
    expect(await screen.findByText(states.d4Message)).toBeTruthy();
    expect(screen.getByText("ユーフォ")).toBeTruthy();
    expect(screen.getByRole("button", { name: states.d4Retry })).toBeTruthy();
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
  });

  it("recovers the native snapshot and preserves the user's prompt", async () => {
    const seen: string[] = [];
    server.use(conversationMessagesHandler("s-1", []), chatStreamDropHandler("search"));
    renderChatPage(chatSearch({ session: "s-1" }));
    await waitFor(() => { expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false); });
    sendText("ユーフォ");
    await screen.findByText(states.d4Message);
    await completedSnapshot(seen);
    fireEvent.click(screen.getByRole("button", { name: states.d4Retry }));
    expect(await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeTruthy();
    expect(seen[0]).toContain("/v1/conversations/s-1/stream");
    expect(screen.getByText("ユーフォ")).toBeTruthy();
    expect(screen.queryByText(states.d4Message)).toBeNull();
  });
});

describe("D4 before the first chunk", () => {
  it("still shows a retry entry point instead of a stuck spinner", async () => {
    server.use(chatStreamImmediateDropHandler());
    renderChatPage();
    sendText("ユーフォ");
    expect(await screen.findByText(states.d4Message)).toBeTruthy();
    expect(screen.getByRole("button", { name: states.d4Retry })).toBeTruthy();
    expect(document.querySelector(".chat-typing")).toBeNull();
    expect(screen.getByText("ユーフォ")).toBeTruthy();
  });
});

describe("D8 session expiry", () => {
  it("shows the inline expiry banner while keeping the conversation", async () => {
    server.use(chatHttpErrorHandler(401));
    renderChatPage();
    sendText("こんにちは");
    expect(await screen.findByText(states.d8Message)).toBeTruthy();
    expect(screen.getByText("こんにちは")).toBeTruthy();
    expect(screen.getByRole("button", { name: states.d8Login })).toBeTruthy();
  });

  it("keeps a codeless 403 on the expiry banner instead of promoting it to D11", async () => {
    server.use(chatCodelessErrorHandler(403));
    renderChatPage();
    sendText("こんにちは");
    expect(await screen.findByText(states.d8Message)).toBeTruthy();
    expect(screen.queryByText(states.d11Message)).toBeNull();
  });

  it("resumes in place with the session's final state after re-login", async () => {
    server.use(conversationMessagesHandler("s-1", []), chatHttpErrorHandler(401));
    renderChatPage(chatSearch({ session: "s-1" }));
    await waitFor(() => { expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false); });
    sendText("ユーフォ");
    await screen.findByText(states.d8Message);
    await completedSnapshot();
    fireEvent.click(screen.getByRole("button", { name: states.d8Resume }));
    expect(await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeTruthy();
    expect(screen.queryByText(states.d8Message)).toBeNull();
  });
});

describe("D11 anonymous budget exhausted", () => {
  it("tells the visitor today's allowance ran out, never that a session expired", async () => {
    server.use(chatBudgetExhaustedHandler());
    renderChatPage();
    sendText("ユーフォ");
    expect(await screen.findByText(states.d11Message)).toBeTruthy();
    expect(screen.queryByText(states.d8Message)).toBeNull();
    expect(screen.getByText("ユーフォ")).toBeTruthy();
  });

  it("offers login as the way forward, with nothing to resume", async () => {
    server.use(chatBudgetExhaustedHandler());
    renderChatPage();
    sendText("ユーフォ");
    await screen.findByText(states.d11Message);
    expect(screen.getByRole("button", { name: states.d11Login })).toBeTruthy();
    expect(screen.queryByRole("button", { name: states.d8Resume })).toBeNull();
  });
});
