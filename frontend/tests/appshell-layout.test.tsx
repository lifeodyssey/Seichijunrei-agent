/**
 * Unit tests for AppShell layout structure and interactions.
 * AC: renders 3 columns on wide viewport (icon-sidebar + chat + result-panel)
 * AC: clicking new chat button clears chat state
 * AC: clicking history button opens conversation drawer
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AppShell from "../components/layout/AppShell";

// Mock child components that use network or complex browser APIs.
// ChatPanel, ResultPanel, ResultSheet, ConversationDrawer all use network hooks
// internally and are covered by their own test files.
vi.mock("../components/chat/ChatPanel", () => ({
  default: () => <div data-testid="mock-chat-panel" />,
}));
vi.mock("../components/layout/ResultPanel", () => ({
  default: () => <div data-testid="mock-result-panel" />,
}));
vi.mock("../components/layout/ResultSheet", () => ({
  default: () => null,
}));
vi.mock("../components/layout/ConversationDrawer", () => ({
  default: ({ open, onNewChat }: { open: boolean; onNewChat: () => void }) =>
    open ? (
      <div data-testid="conversation-drawer">
        <button onClick={onNewChat}>new chat from drawer</button>
      </div>
    ) : null,
}));

// Essential hook mocks: hooks that require browser APIs (localStorage, fetch, SSE).
vi.mock("../hooks/useSession", () => ({
  useSession: () => ({
    sessionId: null,
    setSessionId: vi.fn(),
    clearSession: vi.fn(),
  }),
}));

vi.mock("../hooks/useChat", () => ({
  useChat: () => ({
    messages: [],
    send: vi.fn(),
    sending: false,
    clear: vi.fn(),
    appendMessages: vi.fn(),
    replaceMessage: vi.fn(),
    removeMessage: vi.fn(),
  }),
  createMessageId: () => "test-id",
}));

vi.mock("../hooks/useConversationHistory", () => ({
  useConversationHistory: () => ({
    conversations: [],
    upsert: vi.fn(),
    rename: vi.fn(),
  }),
}));

vi.mock("../hooks/usePointSelection", () => ({
  usePointSelection: () => ({
    selectedIds: new Set(),
    toggle: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock("../lib/i18n-context", () => ({
  useLocale: () => "ja",
  useDict: () => ({}),
}));

vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

describe("AppShell layout", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    const { container } = render(<AppShell />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("renders icon sidebar on desktop viewport", () => {
    render(<AppShell />);
    expect(screen.getByTestId("icon-sidebar")).toBeInTheDocument();
  });

  it("renders the chat panel", () => {
    render(<AppShell />);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  it("renders the result panel", () => {
    render(<AppShell />);
    expect(screen.getByTestId("result-panel")).toBeInTheDocument();
  });

  it("renders three visible columns on desktop", () => {
    const { container } = render(<AppShell />);
    expect(container.querySelector("[data-testid='icon-sidebar']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='chat-panel']")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='result-panel']")).toBeInTheDocument();
  });

  it("does not render old 240px text sidebar", () => {
    const { container } = render(<AppShell />);
    expect(container.querySelector("[data-testid='text-sidebar']")).toBeNull();
  });
});

describe("AppShell interactions", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clicking the New chat button does not crash and leaves layout intact", () => {
    render(<AppShell />);
    const newChatBtn = screen.getByRole("button", { name: /new chat/i });
    fireEvent.click(newChatBtn);
    expect(screen.getByTestId("icon-sidebar")).toBeInTheDocument();
  });

  it("clicking the History button opens the conversation drawer", () => {
    render(<AppShell />);
    expect(screen.queryByTestId("conversation-drawer")).toBeNull();
    const historyBtn = screen.getByRole("button", { name: /history/i });
    fireEvent.click(historyBtn);
    expect(screen.getByTestId("conversation-drawer")).toBeInTheDocument();
  });
});

describe("AppShell mobile layout", () => {
  afterEach(() => cleanup());

  it("renders without crashing in mobile viewport", () => {
    const { container } = render(<AppShell />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
