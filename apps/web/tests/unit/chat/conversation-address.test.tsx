/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { assignedSessionId } from "../../../src/features/chat/conversation-address";
import type { ChatUIMessage } from "../../../src/features/chat/use-chat-session";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { chatStreamHandler } from "../../msw/chat-handlers";
import { server } from "../../msw/node";
import { setLanguages } from "../_i18n";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");
const ASSIGNED = "sess-1337";
const ROUTE_CARD_TEXT = "宇治の聖地を2件、徒歩ルートにまとめました。";

beforeEach(() => { setLanguages(["ja"]); });

function sendText(text: string): void {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: ja.send }));
}

function makeAssistantMessage(sessionId: string | null, id = "m1"): ChatUIMessage {
  return { id, role: "assistant", parts: [{ type: "data-response", data: { intent: "general_qa", session_id: sessionId } }] };
}

describe("assignedSessionId", () => {
  it("reads the id the backend assigned in the conversation's frames", () => {
    expect(assignedSessionId([makeAssistantMessage(ASSIGNED)])).toBe(ASSIGNED);
  });

  it("stays undefined until a frame carries one", () => {
    expect(assignedSessionId([])).toBeUndefined();
    expect(assignedSessionId([makeAssistantMessage(null)])).toBeUndefined();
    expect(assignedSessionId([makeAssistantMessage("")])).toBeUndefined();
  });

  it("ignores the message's own text parts", () => {
    const typed: ChatUIMessage = { id: "m0", role: "user", parts: [{ type: "text", text: "ユーフォ" }] };
    expect(assignedSessionId([typed, makeAssistantMessage(ASSIGNED)])).toBe(ASSIGNED);
  });

  it("keeps the first assignment when later frames repeat it", () => {
    const messages = [makeAssistantMessage(ASSIGNED), makeAssistantMessage("later", "m2")];
    expect(assignedSessionId(messages)).toBe(ASSIGNED);
  });
});

describe("the chat page publishes its conversation to the address bar", () => {
  it("writes the assigned session id into ?session= so a return resumes it", async () => {
    server.use(chatStreamHandler("search", { sessionId: ASSIGNED }));
    const router = renderChatPage();
    sendText("ユーフォ");
    await screen.findByText(ROUTE_CARD_TEXT);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ session: ASSIGNED });
    });
  });

  // The address alone is not the fix: the way out has to carry the id. Both
  // settings entries — the mobile bar's gear and the desktop sidebar's — read
  // it through `useChatSessionId`, a reader over a ref that does not re-render
  // on its own, so this pins the rendered `href`s rather than the mechanism —
  // a reader frozen to its first render leaves the URL correct and this
  // assertion red.
  it("hands the assigned id to every settings link, not just to the address bar", async () => {
    server.use(chatStreamHandler("search", { sessionId: ASSIGNED }));
    renderChatPage();
    sendText("ユーフォ");
    await screen.findByText(ROUTE_CARD_TEXT);
    await waitFor(() => {
      const hrefs = screen.getAllByRole("link", { name: ja.appbar.settings })
        .map((link) => link.getAttribute("href"));
      expect(hrefs).toEqual([`/settings?session=${ASSIGNED}`, `/settings?session=${ASSIGNED}`]);
    });
  });

  it("keeps the conversation on screen: its own publication is not a new entry", async () => {
    server.use(chatStreamHandler("search", { sessionId: ASSIGNED }));
    const router = renderChatPage();
    sendText("ユーフォ");
    await screen.findByText(ROUTE_CARD_TEXT);
    await waitFor(() => { expect(router.state.location.search).toEqual({ session: ASSIGNED }); });
    expect(screen.getByText(ROUTE_CARD_TEXT)).toBeTruthy();
    expect(screen.getByText("ユーフォ")).toBeTruthy();
  });

  it("leaves a resumed conversation's address alone", async () => {
    server.use(chatStreamHandler("search", { sessionId: ASSIGNED }));
    const router = renderChatPage(chatSearch({ session: ASSIGNED }));
    await waitFor(() => { expect(router.state.location.search).toEqual({ session: ASSIGNED }); });
  });
});
