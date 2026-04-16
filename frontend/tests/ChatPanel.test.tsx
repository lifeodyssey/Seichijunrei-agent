/**
 * AC: After first message, WelcomeScreen replaced by message list.
 * -> unit
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatPanel from "@/components/chat/ChatPanel";
import { LocaleProvider } from "@/lib/i18n-context";
import type { ChatMessage } from "@/lib/types";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";

const jaFull = jaDict as unknown as Dict;

function makeMessage(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return { id, role, text, timestamp: Date.now() };
}

function renderChatPanel(messages: ChatMessage[]) {
  return render(
    <LocaleProvider>
      <ChatPanel
        messages={messages}
        sending={false}
        activeMessageId={null}
        dict={jaFull}
        locale="ja"
        onSend={vi.fn()}
        onActivate={vi.fn()}
      />
    </LocaleProvider>,
  );
}

describe("ChatPanel", () => {
  it("renders WelcomeScreen when messages are empty", () => {
    renderChatPanel([]);
    expect(screen.getByText("聖地巡礼")).toBeInTheDocument();
  });

  it("renders message text when messages are non-empty", () => {
    renderChatPanel([makeMessage("m1", "user", "君の名は の聖地を教えて")]);
    expect(screen.getByText("君の名は の聖地を教えて")).toBeInTheDocument();
  });

  it("does not render WelcomeScreen when messages are non-empty", () => {
    renderChatPanel([makeMessage("m1", "user", "テストメッセージ")]);
    expect(screen.queryByText("聖地巡礼")).not.toBeInTheDocument();
  });
});
