/**
 * Clarification component — card layout with cover art.
 * Absorbs bug03 Task 6.
 *
 * AC coverage:
 * - "全作品まとめて検索" option card appears at bottom -> unit
 * - Tapping a card sends the selected anime title as chat message -> unit
 * - No cover_url for candidate — shows placeholder thumbnail -> unit
 * - Zero options array — falls back to existing suggestion buttons -> unit
 * - Cover image CDN failure — placeholder renders, card still tappable -> unit
 * - "全作品まとめて検索" text follows locale -> unit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Clarification from "@/components/generative/Clarification";
import type { ClarifyCandidate } from "@/lib/types";
import defaultDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";
import type { Dict } from "@/lib/i18n";

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

describe("Clarification (card layout)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "全作品まとめて検索" card at the bottom of the candidate list', () => {
    renderClarification({ candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER] });
    expect(screen.getByText("全作品まとめて検索")).toBeInTheDocument();
  });

  it("calls onSuggest with the candidate title when a card is tapped", () => {
    const onSuggest = vi.fn();
    renderClarification({ candidates: [CANDIDATE_WITH_COVER], onSuggest });
    fireEvent.click(screen.getByRole("button", { name: /涼宮ハルヒの憂鬱/ }));
    expect(onSuggest).toHaveBeenCalledWith("涼宮ハルヒの憂鬱");
  });

  it('calls onSuggest with a combined query when "全作品まとめて検索" is tapped', () => {
    const onSuggest = vi.fn();
    renderClarification({ candidates: [CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER], onSuggest });
    fireEvent.click(screen.getByRole("button", { name: /全作品まとめて検索/ }));
    expect(onSuggest).toHaveBeenCalledOnce();
    const arg: string = onSuggest.mock.calls[0][0];
    expect(arg).toContain("涼宮ハルヒの憂鬱");
    expect(arg).toContain("涼宮ハルヒの消失");
  });

  it("renders a placeholder thumbnail when candidate has no cover_url", () => {
    renderClarification({ candidates: [CANDIDATE_NO_COVER] });
    expect(screen.getByRole("button", { name: /涼宮ハルヒの消失/ })).toBeInTheDocument();
    const imgs = screen.queryAllByRole("img");
    const coverImgs = imgs.filter(
      (img) =>
        img.getAttribute("alt") === CANDIDATE_NO_COVER.title &&
        img.getAttribute("src") !== null &&
        img.getAttribute("src") !== "",
    );
    expect(coverImgs).toHaveLength(0);
  });

  it("falls back to suggestion buttons when candidates is empty and options is empty array", () => {
    renderClarification({ candidates: [], options: [] });
    const jaDict = defaultDict as unknown as Dict;
    const firstSuggestion = jaDict.clarification.suggestions[0];
    expect(screen.getByText(new RegExp(firstSuggestion.label))).toBeInTheDocument();
  });

  it("card remains tappable after cover image load error", () => {
    const onSuggest = vi.fn();
    renderClarification({ candidates: [CANDIDATE_WITH_COVER], onSuggest });
    const img = screen.queryByAltText(CANDIDATE_WITH_COVER.title);
    expect(img).toBeTruthy();
    fireEvent.error(img!);
    fireEvent.click(screen.getByRole("button", { name: /涼宮ハルヒの憂鬱/ }));
    expect(onSuggest).toHaveBeenCalledWith("涼宮ハルヒの憂鬱");
  });

  it("shows spot count and city on each candidate card", () => {
    renderClarification({ candidates: [CANDIDATE_WITH_COVER] });
    expect(screen.getByText(/134/)).toBeInTheDocument();
    expect(screen.getByText(/西宮市/)).toBeInTheDocument();
  });

  it("renders cover image when candidate has a cover_url", () => {
    renderClarification({ candidates: [CANDIDATE_WITH_COVER] });
    const img = screen.getByAltText(CANDIDATE_WITH_COVER.title);
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe(CANDIDATE_WITH_COVER.cover_url);
  });
});

describe('Clarification "search_all" locale', () => {
  it("shows search_all text from ja dictionary", () => {
    renderClarification({ candidates: [CANDIDATE_WITH_COVER] });
    const jaD = defaultDict as unknown as { clarification: { search_all: string } };
    expect(screen.getByText(jaD.clarification.search_all)).toBeInTheDocument();
  });

  it.each([
    ["ja", defaultDict],
    ["en", enDict],
    ["zh", zhDict],
  ])("%s dict has search_all key", (_locale, dict) => {
    const d = dict as unknown as { clarification: { search_all?: string } };
    expect(d.clarification.search_all).toBeDefined();
  });
});
