import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageList from "../components/chat/MessageList";
import type { ChatMessage } from "../lib/types";
import defaultDict from "../lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

vi.mock("@/contexts/SuggestContext", () => ({
  useSuggest: () => vi.fn(),
}));

// Mock MessageBubble to isolate MessageList behavior
vi.mock("../components/chat/MessageBubble", () => ({
  default: ({
    message,
    onActivate,
    isActive,
    onOpenDrawer,
  }: {
    message: ChatMessage;
    userQuery?: string;
    onActivate?: (id: string) => void;
    isActive?: boolean;
    onOpenDrawer?: () => void;
  }) => (
    <div data-testid={`bubble-${message.id}`} data-role={message.role}>
      <span data-testid="bubble-text">{message.text}</span>
      {message.role === "assistant" && onActivate && (
        <button
          data-testid={`activate-${message.id}`}
          onClick={() => onActivate(message.id)}
        >
          activate
        </button>
      )}
      {isActive && <span data-testid="active-marker">active</span>}
      {onOpenDrawer && (
        <button data-testid="open-drawer" onClick={onOpenDrawer}>
          drawer
        </button>
      )}
    </div>
  ),
}));

function makeUserMessage(id: string, text: string): ChatMessage {
  return { id, role: "user", text, timestamp: Date.now() };
}

function makeAssistantMessage(id: string, text: string): ChatMessage {
  return { id, role: "assistant", text, timestamp: Date.now() };
}

describe("MessageList", () => {
  it("renders user message text", () => {
    const messages: ChatMessage[] = [makeUserMessage("u1", "Hello world")];
    render(<MessageList messages={messages} />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders assistant message text", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage("a1", "Hi there, how can I help?"),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText("Hi there, how can I help?")).toBeInTheDocument();
  });

  it("calls onActivate with correct messageId when activate button is clicked", () => {
    const onActivate = vi.fn();
    const messages: ChatMessage[] = [
      makeUserMessage("u1", "Search for spots"),
      makeAssistantMessage("a1", "Here are the results"),
    ];
    render(<MessageList messages={messages} onActivate={onActivate} />);

    const activateBtn = screen.getByTestId("activate-a1");
    activateBtn.click();
    expect(onActivate).toHaveBeenCalledWith("a1");
  });

  it("renders empty state when messages array is empty (no crash)", () => {
    const { container } = render(<MessageList messages={[]} />);
    // Empty messages should render the welcome card, not crash
    expect(container.firstChild).toBeTruthy();
    // Should show the welcome title from dict
    expect(screen.getByText(defaultDict.chat.welcome_title)).toBeInTheDocument();
  });

  it("marks the active message", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage("a1", "Result 1"),
      makeAssistantMessage("a2", "Result 2"),
    ];
    render(<MessageList messages={messages} activeMessageId="a2" />);

    // Only a2 should have the active marker
    expect(screen.queryByTestId("active-marker")).toBeInTheDocument();
    expect(
      screen.getByTestId("bubble-a2").querySelector('[data-testid="active-marker"]'),
    ).toBeTruthy();
    expect(
      screen.getByTestId("bubble-a1").querySelector('[data-testid="active-marker"]'),
    ).toBeNull();
  });

  it("renders multiple messages in order", () => {
    const messages: ChatMessage[] = [
      makeUserMessage("u1", "First message"),
      makeAssistantMessage("a1", "First reply"),
      makeUserMessage("u2", "Second message"),
    ];
    render(<MessageList messages={messages} />);

    const bubbles = screen.getAllByTestId(/^bubble-(u|a)\d+$/);
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]).toHaveAttribute("data-role", "user");
    expect(bubbles[1]).toHaveAttribute("data-role", "assistant");
    expect(bubbles[2]).toHaveAttribute("data-role", "user");
  });
});
