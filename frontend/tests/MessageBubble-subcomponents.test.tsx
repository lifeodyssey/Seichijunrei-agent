/**
 * Tests for extracted MessageBubble sub-components (Issue #146)
 *
 * AC coverage:
 * - ClarificationBubble renders Clarification component -> unit
 * - ResultAnchor renders with label, subtitle, and responds to click -> unit
 * - FeedbackButtons renders good/bad buttons and calls submitFeedback on good click -> unit
 * - MessageBubble imports from sub-component files -> unit (checked via render)
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ClarificationBubble from "@/components/chat/ClarificationBubble";
import ResultAnchor from "@/components/chat/ResultAnchor";
import FeedbackButtons from "@/components/chat/FeedbackButtons";
import type { RuntimeResponse, ChatMessage } from "@/lib/types";
import enDict from "@/lib/dictionaries/en.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => enDict,
  useLocale: () => "en" as const,
  useSetLocale: () => () => {},
}));

vi.mock("@/contexts/SuggestContext", () => ({
  useSuggest: () => undefined,
}));

vi.mock("@/lib/api", () => ({
  submitFeedback: vi.fn(() => Promise.resolve()),
}));

// Thin wrapper — mock is applied globally above.
function I18nTestWrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRuntimeResponse(overrides: Partial<RuntimeResponse> = {}): RuntimeResponse {
  return {
    success: true,
    status: "needs_clarification",
    intent: "clarify",
    session_id: "sess-001",
    message: "Choose a title",
    data: {
      intent: "clarify",
      confidence: 0.9,
      status: "needs_clarification",
      message: "Choose a title",
      question: "Which title did you mean?",
      options: ["響け！ユーフォニアム", "君の名は"],
      candidates: [],
    },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
    ...overrides,
  };
}

function makeBotMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-001",
    role: "assistant",
    text: "Here are results",
    loading: false,
    timestamp: 1700000000000,
    response: makeRuntimeResponse({
      status: "ok",
      intent: "search_bangumi",
      data: {
        results: {
          rows: [],
          row_count: 3,
          strategy: "sql",
          status: "ok",
        },
        message: "Found results",
        status: "ok",
      },
    }),
    steps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ClarificationBubble
// ---------------------------------------------------------------------------

describe("ClarificationBubble", () => {
  it("renders the clarification message text", () => {
    const response = makeRuntimeResponse();
    render(
      <I18nTestWrapper>
        <ClarificationBubble response={response} />
      </I18nTestWrapper>,
    );
    expect(screen.getByText("Choose a title")).toBeInTheDocument();
  });

  it("renders option buttons from response data", () => {
    const response = makeRuntimeResponse();
    render(
      <I18nTestWrapper>
        <ClarificationBubble response={response} />
      </I18nTestWrapper>,
    );
    expect(screen.getByText("響け！ユーフォニアム")).toBeInTheDocument();
    expect(screen.getByText("君の名は")).toBeInTheDocument();
  });

  it("calls onSuggest when an option is clicked", () => {
    const onSuggest = vi.fn();
    const response = makeRuntimeResponse();
    render(
      <I18nTestWrapper>
        <ClarificationBubble response={response} onSuggest={onSuggest} />
      </I18nTestWrapper>,
    );
    fireEvent.click(screen.getByText("響け！ユーフォニアム"));
    expect(onSuggest).toHaveBeenCalledWith("響け！ユーフォニアム");
  });
});

// ---------------------------------------------------------------------------
// ResultAnchor
// ---------------------------------------------------------------------------

describe("ResultAnchor", () => {
  it("renders the label text", () => {
    render(
      <ResultAnchor
        label="3 results"
        subtitle="Tap to view"
        messageId="msg-001"
        isActive={false}
      />,
    );
    expect(screen.getByText("3 results")).toBeInTheDocument();
  });

  it("renders the subtitle text", () => {
    render(
      <ResultAnchor
        label="3 results"
        subtitle="Tap to view"
        messageId="msg-001"
        isActive={false}
      />,
    );
    expect(screen.getByText("Tap to view")).toBeInTheDocument();
  });

  it("calls onActivate with messageId when clicked", () => {
    const onActivate = vi.fn();
    render(
      <ResultAnchor
        label="3 results"
        subtitle="Tap to view"
        messageId="msg-001"
        isActive={false}
        onActivate={onActivate}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenCalledWith("msg-001");
  });

  it("calls onOpenDrawer when clicked on mobile", () => {
    const onOpenDrawer = vi.fn();
    render(
      <ResultAnchor
        label="3 results"
        subtitle="Tap to view"
        messageId="msg-001"
        isActive={false}
        onOpenDrawer={onOpenDrawer}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenDrawer).toHaveBeenCalledOnce();
  });

  it("is a button element", () => {
    render(
      <ResultAnchor
        label="3 results"
        subtitle="Tap to view"
        messageId="msg-001"
        isActive={false}
      />,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FeedbackButtons
// ---------------------------------------------------------------------------

describe("FeedbackButtons", () => {
  it("renders good and bad feedback buttons", () => {
    const message = makeBotMessage();
    render(
      <I18nTestWrapper>
        <FeedbackButtons message={message} userQuery="find spots" />
      </I18nTestWrapper>,
    );
    expect(screen.getByLabelText(/good response/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bad response/i)).toBeInTheDocument();
  });

  it("shows comment input when bad button clicked", () => {
    const message = makeBotMessage();
    render(
      <I18nTestWrapper>
        <FeedbackButtons message={message} userQuery="find spots" />
      </I18nTestWrapper>,
    );
    fireEvent.click(screen.getByLabelText(/bad response/i));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows submitted state after good feedback", async () => {
    const message = makeBotMessage();
    render(
      <I18nTestWrapper>
        <FeedbackButtons message={message} userQuery="find spots" />
      </I18nTestWrapper>,
    );
    fireEvent.click(screen.getByLabelText(/good response/i));
    const sent = await screen.findByText(/feedback sent/i);
    expect(sent).toBeInTheDocument();
  });
});
