/**
 * @vitest-environment jsdom
 */
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PopularRanking } from "../../../src/components/home/PopularRanking";
import { server } from "../../msw/node";
import { popularEmptyHandler, popularErrorHandler, popularHandler } from "../../msw/popular";
import { setLanguages } from "../_i18n";
import { renderHome } from "./_render";

beforeEach(() => { setLanguages(["ja-JP"]); });

describe("PopularRanking", () => {
  it("shows a loading status before the ranking resolves", () => {
    server.use(popularHandler);
    renderHome(<PopularRanking />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders ranked titles linking to their anime pages", async () => {
    server.use(popularHandler);
    renderHome(<PopularRanking />);
    const link = await screen.findByRole("link", { name: /Your Name/ });
    expect(link.getAttribute("href")).toBe("/anime/1");
  });

  it("shows the empty state when the catalog has no popular titles", async () => {
    server.use(popularEmptyHandler);
    renderHome(<PopularRanking />);
    expect(await screen.findByText("まだ人気の作品がありません")).toBeTruthy();
  });

  it("degrades to the empty state when the endpoint fails", async () => {
    server.use(popularErrorHandler);
    renderHome(<PopularRanking />);
    expect(await screen.findByText("まだ人気の作品がありません")).toBeTruthy();
  });

  it("shows the Chinese title for zh readers when available", async () => {
    setLanguages(["zh-CN"]);
    server.use(popularHandler);
    renderHome(<PopularRanking />);
    expect(await screen.findByText("你的名字")).toBeTruthy();
  });
});
