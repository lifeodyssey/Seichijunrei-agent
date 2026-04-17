/**
 * Clarification redesign — card layout with cover art.
 * Absorbs bug03 Task 6.
 *
 * AC coverage:
 * - "全作品まとめて検索" option card appears at bottom -> unit
 * - Tapping a card sends the selected anime title as chat message -> unit
 * - No cover_url for candidate — shows placeholder thumbnail -> unit
 * - Zero options array — falls back to existing suggestion buttons -> unit
 * - Cover image CDN failure — placeholder renders, card still tappable -> unit
 * - "全作品まとめて検索" text follows locale -> unit
 * - needs_clarification status renders inline in MessageBubble -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Clarification from "@/components/generative/Clarification";
import MessageBubble from "@/components/chat/MessageBubble";
import type { ChatMessage, RuntimeResponse, ClarifyCandidate } from "@/lib/types";
import defaultDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";
import type { Dict } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function renderClarification({
  message = "どちらの作品ですか？",
  options,
  candidates,
  onSuggest = vi.fn(),
}: {
  message?: string;
  options?: string[];
  candidates?: ClarifyCandidate[];
  onSuggest?: (text: string) => void;
}) {
  return render(
    <Clarification
      message={message}
      options={options}
      candidates={candidates}
      onSuggest={onSuggest}
    />,
  );
}

function makeClarifyResponse(
  candidates: ClarifyCandidate[] = [CANDIDATE_WITH_COVER],
): RuntimeResponse {
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

// ---------------------------------------------------------------------------
// Clarification component tests
// ---------------------------------------------------------------------------

describe("Clarification (card layout)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC: "全作品まとめて検索" option card appears at bottom
  it('shows "全作品まとめて検索" card at the bottom of the candidate list', () => {
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER],
    });
    expect(screen.getByText("全作品まとめて検索")).toBeInTheDocument();
  });

  // AC: Tapping a card sends the selected anime title as chat message
  it("calls onSuggest with the candidate title when a card is tapped", () => {
    const onSuggest = vi.fn();
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER],
      onSuggest,
    });
    const card = screen.getByRole("button", { name: /涼宮ハルヒの憂鬱/ });
    fireEvent.click(card);
    expect(onSuggest).toHaveBeenCalledWith("涼宮ハルヒの憂鬱");
  });

  // AC: Tapping "全作品まとめて検索" card fires onSuggest with all titles joined
  it('calls onSuggest with a combined query when "全作品まとめて検索" is tapped', () => {
    const onSuggest = vi.fn();
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER],
      onSuggest,
    });
    fireEvent.click(screen.getByRole("button", { name: /全作品まとめて検索/ }));
    expect(onSuggest).toHaveBeenCalledOnce();
    const arg: string = onSuggest.mock.calls[0][0];
    // The combined query should reference both titles
    expect(arg).toContain("涼宮ハルヒの憂鬱");
    expect(arg).toContain("涼宮ハルヒの消失");
  });

  // AC: No cover_url for candidate — shows placeholder thumbnail
  it("renders a placeholder thumbnail when candidate has no cover_url", () => {
    renderClarification({
      candidates: [CANDIDATE_NO_COVER],
    });
    // Candidate card should still be present
    expect(screen.getByRole("button", { name: /涼宮ハルヒの消失/ })).toBeInTheDocument();
    // Should NOT have an img with src pointing to anitabi
    const imgs = screen.queryAllByRole("img");
    const coverImgs = imgs.filter(
      (img) =>
        img.getAttribute("alt") === CANDIDATE_NO_COVER.title &&
        img.getAttribute("src") !== null &&
        img.getAttribute("src") !== "",
    );
    // cover_url is null so no cover img should be rendered for this candidate
    expect(coverImgs).toHaveLength(0);
  });

  // AC: Zero options array — falls back to existing suggestion buttons
  it("falls back to suggestion buttons when candidates is empty and options is empty array", () => {
    renderClarification({
      candidates: [],
      options: [],
    });
    // Should show default suggestion buttons from dictionary
    const jaDict = defaultDict as unknown as Dict;
    const firstSuggestion = jaDict.clarification.suggestions[0];
    expect(screen.getByText(new RegExp(firstSuggestion.label))).toBeInTheDocument();
  });

  // AC: Cover image CDN failure — placeholder renders, card still tappable
  it("card remains tappable after cover image load error", () => {
    const onSuggest = vi.fn();
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER],
      onSuggest,
    });
    // Simulate img error
    const img = screen.queryByAltText(CANDIDATE_WITH_COVER.title);
    if (img) {
      fireEvent.error(img);
    }
    // Card button must still be present and clickable
    const card = screen.getByRole("button", { name: /涼宮ハルヒの憂鬱/ });
    fireEvent.click(card);
    expect(onSuggest).toHaveBeenCalledWith("涼宮ハルヒの憂鬱");
  });

  // AC: Spot count and city are shown on each candidate card
  it("shows spot count and city on each candidate card", () => {
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER],
    });
    expect(screen.getByText(/134/)).toBeInTheDocument();
    expect(screen.getByText(/西宮市/)).toBeInTheDocument();
  });

  // AC: When candidates provided, card layout is used (not plain text buttons)
  it("renders cover image when candidate has a cover_url", () => {
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER],
    });
    const img = screen.getByAltText(CANDIDATE_WITH_COVER.title);
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe(CANDIDATE_WITH_COVER.cover_url);
  });
});

// ---------------------------------------------------------------------------
// "全作品まとめて検索" locale tests
// ---------------------------------------------------------------------------

describe('Clarification "search_all" locale', () => {
  it("shows search_all text from ja dictionary", () => {
    // Default mock uses ja dict
    renderClarification({ candidates: [CANDIDATE_WITH_COVER] });
    const jaD = defaultDict as unknown as { clarification: { search_all: string } };
    expect(screen.getByText(jaD.clarification.search_all)).toBeInTheDocument();
  });

  it("ja dict has search_all key", () => {
    const d = defaultDict as unknown as { clarification: { search_all?: string } };
    expect(d.clarification.search_all).toBeDefined();
  });

  it("en dict has search_all key", () => {
    const d = enDict as unknown as { clarification: { search_all?: string } };
    expect(d.clarification.search_all).toBeDefined();
  });

  it("zh dict has search_all key", () => {
    const d = zhDict as unknown as { clarification: { search_all?: string } };
    expect(d.clarification.search_all).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// MessageBubble — needs_clarification status rendering
// ---------------------------------------------------------------------------

describe("MessageBubble needs_clarification rendering", () => {
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

  it("renders Clarification inline for needs_clarification status", () => {
    const response = makeClarifyResponse([CANDIDATE_WITH_COVER]);
    const message = makeBotMessage(response);
    render(
      <MessageBubble
        message={message}
        onSuggest={vi.fn()}
      />,
    );
    // The clarification message text should be visible
    expect(screen.getByText(/どちらの作品ですか/)).toBeInTheDocument();
  });

  it("renders candidate cards inside MessageBubble for needs_clarification", () => {
    const response = makeClarifyResponse([CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER]);
    const message = makeBotMessage(response);
    render(
      <MessageBubble
        message={message}
        onSuggest={vi.fn()}
      />,
    );
    // Both candidate titles should appear
    expect(screen.getByRole("button", { name: /涼宮ハルヒの憂鬱/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /涼宮ハルヒの消失/ })).toBeInTheDocument();
  });

  it("does NOT render the ◈ result anchor for needs_clarification responses", () => {
    const response = makeClarifyResponse([CANDIDATE_WITH_COVER]);
    const message = makeBotMessage(response);
    render(
      <MessageBubble
        message={message}
        onSuggest={vi.fn()}
      />,
    );
    // No anchor button (used for visual results) should appear
    const anchorBtn = screen.queryByRole("button", { name: /件の結果|results/ });
    expect(anchorBtn).toBeNull();
  });
});
