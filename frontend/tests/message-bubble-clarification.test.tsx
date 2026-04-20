/**
 * MessageBubble — needs_clarification status rendering.
 * Split from clarification-redesign.test.tsx.
 *
 * AC coverage:
 * - needs_clarification status renders inline in MessageBubble -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageBubble from "@/components/chat/MessageBubble";
import type { ChatMessage, RuntimeResponse, ClarifyCandidate } from "@/lib/types";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

const CANDIDATE_WITH_COVER: ClarifyCandidate = {
  title: "涼宮ハルヒの憂鬱",
  cover_url: "https://image.anitabi.cn/bangumi/485.jpg",
  spot_count: 134,
  city: "西宮市",
};

const CANDIDATE_NO_COVER: ClarifyCandidate = {
  title: "涼宮ハルヒの消失",
  cover_url: null,
  spot_count: 42,
  city: "西宮市",
};

function makeClarifyResponse(candidates: ClarifyCandidate[] = [CANDIDATE_WITH_COVER]): RuntimeResponse {
  return {
    success: true,
    status: "needs_clarification",
    intent: "clarify",
    session_id: "s-001",
    message: "どちらの作品ですか？",
    data: {
      intent: "clarify",
      confidence: 0.8,
      status: "needs_clarification",
      message: "どちらの作品ですか？",
      question: "どちらの作品ですか？",
      options: candidates.map((c) => c.title),
      candidates,
    },
    session: { interaction_count: 1, route_history_count: 0 },
    route_history: [],
    errors: [],
  };
}

function makeBotMessage(response: RuntimeResponse): ChatMessage {
  return {
    id: "msg-001",
    role: "assistant",
    text: "どちらの作品ですか？",
    response,
    loading: false,
    timestamp: Date.now(),
  };
}

describe("MessageBubble needs_clarification rendering", () => {
  it("renders Clarification inline for needs_clarification status", () => {
    const message = makeBotMessage(makeClarifyResponse([CANDIDATE_WITH_COVER]));
    render(<MessageBubble message={message} onSuggest={vi.fn()} />);
    expect(screen.getByText(/どちらの作品ですか/)).toBeInTheDocument();
  });

  it("renders candidate cards inside MessageBubble for needs_clarification", () => {
    const message = makeBotMessage(
      makeClarifyResponse([CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER]),
    );
    render(<MessageBubble message={message} onSuggest={vi.fn()} />);
    expect(screen.getByRole("button", { name: /涼宮ハルヒの憂鬱/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /涼宮ハルヒの消失/ })).toBeInTheDocument();
  });

  it("does NOT render the result anchor for needs_clarification responses", () => {
    const message = makeBotMessage(makeClarifyResponse([CANDIDATE_WITH_COVER]));
    render(<MessageBubble message={message} onSuggest={vi.fn()} />);
    const anchorBtn = screen.queryByRole("button", { name: /件の結果|results/ });
    expect(anchorBtn).toBeNull();
  });
});
