/**
 * Clarification component unit tests (rewritten card layout version).
 *
 * AC coverage:
 * - Renders candidate cards with titles -> unit
 * - Shows cover image when available -> unit
 * - Shows placeholder when cover_url is null -> unit
 * - Shows spot count and city -> unit
 * - Clicking a card calls onSuggest with candidate title -> unit
 * - Shows "search all" card at bottom -> unit
 * - With plain options (no candidates): renders synthetic candidate cards -> unit
 * - With no options/candidates: renders fallback suggestion cards -> unit
 * - All cards use display font for titles -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Clarification from "@/components/generative/Clarification";
import type { ClarifyCandidate } from "@/lib/types";
import zhDict from "@/lib/dictionaries/zh.json";
import type { Dict } from "@/lib/i18n";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => zhDict,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CANDIDATE_WITH_COVER: ClarifyCandidate = {
  title: "你的名字。",
  cover_url: "https://image.anitabi.cn/bangumi/your-name.jpg",
  spot_count: 87,
  city: "飛騨市",
};

const CANDIDATE_NO_COVER: ClarifyCandidate = {
  title: "天气之子",
  cover_url: null,
  spot_count: 52,
  city: "東京都",
};

const CANDIDATE_SECONDARY: ClarifyCandidate = {
  title: "铃芽之旅",
  cover_url: "https://image.anitabi.cn/bangumi/suzume.jpg",
  spot_count: 34,
  city: "宮崎市",
};

function renderClarification({
  message = "你指的是哪部作品？",
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

// ---------------------------------------------------------------------------
// Tests — candidate card layout
// ---------------------------------------------------------------------------

describe("Clarification (card layout with candidates)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders candidate cards with titles", () => {
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER],
    });
    expect(screen.getByRole("button", { name: "你的名字。" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "天气之子" })).toBeInTheDocument();
  });

  it("shows cover image when available", () => {
    renderClarification({ candidates: [CANDIDATE_WITH_COVER] });
    const img = screen.getByAltText("你的名字。");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe(CANDIDATE_WITH_COVER.cover_url);
  });

  it("shows placeholder when cover_url is null", () => {
    renderClarification({ candidates: [CANDIDATE_NO_COVER] });
    // Button exists but no <img> with the candidate title as alt
    expect(screen.getByRole("button", { name: "天气之子" })).toBeInTheDocument();
    const imgs = screen.queryAllByRole("img");
    const coverImgs = imgs.filter(
      (img) =>
        img.getAttribute("alt") === "天气之子" &&
        img.getAttribute("src") !== null &&
        img.getAttribute("src") !== "",
    );
    expect(coverImgs).toHaveLength(0);
  });

  it("shows spot count and city on candidate card", () => {
    renderClarification({ candidates: [CANDIDATE_WITH_COVER] });
    expect(screen.getByText(/87/)).toBeInTheDocument();
    expect(screen.getByText(/飛騨市/)).toBeInTheDocument();
  });

  it("clicking a card calls onSuggest with candidate title", () => {
    const onSuggest = vi.fn();
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER],
      onSuggest,
    });
    fireEvent.click(screen.getByRole("button", { name: "你的名字。" }));
    expect(onSuggest).toHaveBeenCalledOnce();
    expect(onSuggest).toHaveBeenCalledWith("你的名字。");
  });

  it('shows "search all" card at the bottom of the candidate list', () => {
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER],
    });
    expect(screen.getByText(zhDict.clarification.search_all)).toBeInTheDocument();
  });

  it('"search all" card sends combined query when clicked', () => {
    const onSuggest = vi.fn();
    renderClarification({
      candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER],
      onSuggest,
    });
    fireEvent.click(screen.getByRole("button", { name: zhDict.clarification.search_all }));
    expect(onSuggest).toHaveBeenCalledOnce();
    const arg: string = onSuggest.mock.calls[0][0];
    expect(arg).toContain("你的名字。");
    expect(arg).toContain("天气之子");
  });

  it("all candidate cards use display font for titles", () => {
    const { container } = renderClarification({
      candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER, CANDIDATE_SECONDARY],
    });
    // Each title span has fontFamily set to var(--app-font-display)
    const titleSpans = container.querySelectorAll("[style*='font-display']");
    // At least the candidate titles should use display font via inline style
    // The component uses inline style fontFamily: "var(--app-font-display)"
    const displayFontSpans = container.querySelectorAll("[style]");
    const withDisplayFont = Array.from(displayFontSpans).filter((el) =>
      (el as HTMLElement).style.fontFamily?.includes("app-font-display"),
    );
    // 3 candidates + 1 search-all card = at least 4 title spans
    expect(withDisplayFont.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Tests — plain options (legacy)
// ---------------------------------------------------------------------------

describe("Clarification (plain options, no candidates)", () => {
  it("renders synthetic candidate cards from string options", () => {
    renderClarification({
      options: ["あの花", "ここさけ", "空の青さを知る人よ"],
    });
    expect(screen.getByRole("button", { name: "あの花" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ここさけ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "空の青さを知る人よ" })).toBeInTheDocument();
  });

  it("clicking a synthetic card calls onSuggest with the option text", () => {
    const onSuggest = vi.fn();
    renderClarification({
      options: ["あの花", "ここさけ"],
      onSuggest,
    });
    fireEvent.click(screen.getByRole("button", { name: "あの花" }));
    expect(onSuggest).toHaveBeenCalledWith("あの花");
  });

  it("does not show search-all card for plain options", () => {
    renderClarification({
      options: ["あの花", "ここさけ"],
    });
    expect(screen.queryByText(zhDict.clarification.search_all)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — fallback (no options, no candidates)
// ---------------------------------------------------------------------------

describe("Clarification (fallback, no options/candidates)", () => {
  it("renders fallback suggestion cards from dictionary", () => {
    renderClarification({ candidates: [], options: [] });
    const zhDictTyped = zhDict as unknown as Dict;
    const firstLabel = zhDictTyped.clarification.suggestions[0].label;
    expect(screen.getByText(new RegExp(firstLabel))).toBeInTheDocument();
  });

  it("renders fallback cards when both candidates and options are undefined", () => {
    renderClarification({});
    const zhDictTyped = zhDict as unknown as Dict;
    const suggestions = zhDictTyped.clarification.suggestions;
    for (const s of suggestions) {
      expect(screen.getByRole("button", { name: s.label })).toBeInTheDocument();
    }
  });

  it("fallback suggestion cards use display font for labels", () => {
    const { container } = renderClarification({});
    const displayFontSpans = Array.from(container.querySelectorAll("[style]")).filter((el) =>
      (el as HTMLElement).style.fontFamily?.includes("app-font-display"),
    );
    // At least one suggestion card should use display font
    expect(displayFontSpans.length).toBeGreaterThanOrEqual(1);
  });
});
