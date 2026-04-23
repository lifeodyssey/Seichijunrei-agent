/**
 * Integration test: Welcome screen to chat transition.
 *
 * Tests the multi-component flow:
 * - ChatPanel renders WelcomeScreen when messages are empty
 * - User types in the WelcomeScreen input
 * - Submitting calls onSend with the correct text
 *
 * Mocks: i18n-context
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPanel from "@/components/chat/ChatPanel";
import { LocaleProvider } from "@/lib/i18n-context";
import type { ChatMessage } from "@/lib/types";
import type { Dict } from "@/lib/i18n";
import defaultDict from "@/lib/dictionaries/ja.json";

const jaFull = defaultDict as unknown as Dict;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChatPanel(
  messages: ChatMessage[],
  onSend = vi.fn(),
) {
  return {
    onSend,
    ...render(
      <LocaleProvider>
        <ChatPanel
          messages={messages}
          sending={false}
          activeMessageId={null}
          dict={jaFull}
          locale="ja"
          onSend={onSend}
          onActivate={vi.fn()}
        />
      </LocaleProvider>,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration: Welcome screen to chat transition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows WelcomeScreen when messages array is empty", () => {
    renderChatPanel([]);

    // WelcomeScreen shows the title "聖地巡礼"
    expect(screen.getByText("聖地巡礼")).toBeInTheDocument();
    // And the tagline from ja dict
    expect(
      screen.getByText("アニメの舞台を探して、巡礼ルートを作ろう"),
    ).toBeInTheDocument();
  });

  it("WelcomeScreen has a text input for typing queries", () => {
    renderChatPanel([]);

    // The input should be present with the Japanese placeholder
    const input = screen.getByPlaceholderText(
      /アニメ名を入力/,
    );
    expect(input).toBeInTheDocument();
  });

  it("typing and pressing Enter in WelcomeScreen calls onSend", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderChatPanel([], onSend);

    const input = screen.getByPlaceholderText(
      /アニメ名を入力/,
    );

    await user.type(input, "君の名は の聖地");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      // onSend is called from ChatPanel.handleSend which adds coords param
      expect(onSend).toHaveBeenCalledWith("君の名は の聖地", null);
    });
  });

  it("typing and clicking the send button calls onSend", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderChatPanel([], onSend);

    const input = screen.getByPlaceholderText(
      /アニメ名を入力/,
    );

    await user.type(input, "響け！ユーフォニアム");

    // Find the send button by its aria-label (ja dict: "送信")
    const sendBtn = screen.getByRole("button", { name: defaultDict.chat.send });
    await user.click(sendBtn);

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("響け！ユーフォニアム", null);
    });
  });

  it("clicking a suggestion chip calls onSend with the chip query", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderChatPanel([], onSend);

    // Chip labels in ja locale
    const searchChip = screen.getByText("聖地を検索");
    await user.click(searchChip);

    await waitFor(() => {
      // The chip sends the locale-specific query string
      expect(onSend).toHaveBeenCalledWith(
        "君の名は の聖地を教えて",
        null,
      );
    });
  });

  it("does not submit when input is empty", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    renderChatPanel([], onSend);

    const input = screen.getByPlaceholderText(
      /アニメ名を入力/,
    );

    // Try Enter with empty input
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not show WelcomeScreen when messages are present", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        text: "テストメッセージ",
        timestamp: Date.now(),
      },
    ];
    renderChatPanel(messages);

    // Title should not be present — WelcomeScreen is gone
    expect(screen.queryByText("聖地巡礼")).not.toBeInTheDocument();
    // The user message should render
    expect(screen.getByText("テストメッセージ")).toBeInTheDocument();
  });
});
