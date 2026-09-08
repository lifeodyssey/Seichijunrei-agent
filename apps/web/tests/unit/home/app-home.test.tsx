/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHome } from "../../../src/components/home/AppHome";
import { server } from "../../msw/node";
import { popularEmptyHandler } from "../../msw/popular";
import { usersSavedRoutesWithDraftHandler } from "../../msw/users";
import { setLanguages } from "../_i18n";
import { renderHome } from "./_render";

beforeEach(() => {
  setLanguages(["ja-JP"]);
  server.use(popularEmptyHandler, usersSavedRoutesWithDraftHandler);
});

describe("AppHome composition", () => {
  it("wires the search box submit to the onSearch handler", () => {
    const onSearch = vi.fn();
    renderHome(<AppHome onSearch={onSearch} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Suzume" } });
    fireEvent.click(screen.getByRole("button", { name: "ルートを作る" }));
    expect(onSearch).toHaveBeenCalledWith("Suzume");
  });
});

const LOCALE_COPY = [
  { tag: "ja-JP", cta: "ルートを作る", continueTitle: "続きから", popularEmpty: "まだ人気の作品がありません" },
  { tag: "zh-CN", cta: "生成路线", continueTitle: "继续上次", popularEmpty: "暂时还没有人气作品" },
  { tag: "en-US", cta: "Build a route", continueTitle: "Continue from", popularEmpty: "No popular titles yet" },
] as const;

describe("AppHome i18n", () => {
  it.each(LOCALE_COPY)("renders all three blocks' copy for $tag", async ({ tag, cta, continueTitle, popularEmpty }) => {
    setLanguages([tag]);
    renderHome(<AppHome onSearch={vi.fn()} />);
    expect(await screen.findByText(continueTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: cta })).toBeTruthy();
    expect(await screen.findByText(popularEmpty)).toBeTruthy();
  });
});
