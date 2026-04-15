/**
 * AC: Empty state shows WelcomeScreen with logo, tagline, 3 quick-action cards, anime chips.
 * AC: After first message sent, WelcomeScreen replaced by message list.
 * AC: Quick-action card tap sends corresponding query.
 * AC: /v1/bangumi/popular returns empty — anime chips hidden, quick actions visible.
 * AC: /v1/bangumi/popular network failure — WelcomeScreen renders without crash.
 * AC: Welcome tagline and quick-action labels render in ja, zh, en.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./mocks/server";
import WelcomeScreen from "@/components/chat/WelcomeScreen";
import type { Dict, Locale } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import zhDict from "@/lib/dictionaries/zh.json";
import enDict from "@/lib/dictionaries/en.json";

// Build the full ja/zh/en dicts cast to Dict (they all have welcome_screen after our additions)
const jaFull = jaDict as unknown as Dict;
const zhFull = zhDict as unknown as Dict;
const enFull = enDict as unknown as Dict;

function renderWelcomeScreen(
  onSend: (text: string) => void = vi.fn(),
  dict: Dict = jaFull,
  locale: Locale = "ja",
) {
  return render(
    <WelcomeScreen onSend={onSend} dict={dict} locale={locale} />,
  );
}

describe("WelcomeScreen", () => {
  it("renders the logo with display font text", () => {
    renderWelcomeScreen();
    expect(screen.getByText("聖地巡礼")).toBeInTheDocument();
  });

  it("renders the tagline in Japanese", () => {
    renderWelcomeScreen(vi.fn(), jaFull);
    expect(
      screen.getByText("アニメの舞台を探して、巡礼ルートを作ろう"),
    ).toBeInTheDocument();
  });

  it("renders 3 quick-action cards", () => {
    renderWelcomeScreen();
    expect(screen.getByText("作品で探す")).toBeInTheDocument();
    expect(screen.getByText("近くの聖地")).toBeInTheDocument();
    expect(screen.getByText("ルートを作成")).toBeInTheDocument();
  });

  it("quick-action card tap calls onSend with the correct query", () => {
    const onSend = vi.fn();
    renderWelcomeScreen(onSend);
    fireEvent.click(screen.getByText("作品で探す"));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("君の名は の聖地を教えて");
  });

  it("all 3 quick-action buttons are clickable and each calls onSend", () => {
    const onSend = vi.fn();
    renderWelcomeScreen(onSend);
    fireEvent.click(screen.getByText("近くの聖地"));
    fireEvent.click(screen.getByText("ルートを作成"));
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("renders popular_label section header when bangumi popular chips load", async () => {
    server.use(
      http.get("http://localhost:8000/v1/bangumi/popular", () => {
        return HttpResponse.json({
          bangumi: [
            { bangumi_id: "bg-001", title: "响け", cover_url: null },
          ],
        });
      }),
    );
    renderWelcomeScreen();
    // The popular_label text should appear once the async fetch resolves
    const label = await screen.findByText("人気の作品");
    expect(label).toBeInTheDocument();
  });

  it("does not crash when /v1/bangumi/popular returns empty", async () => {
    server.use(
      http.get("http://localhost:8000/v1/bangumi/popular", () => {
        return HttpResponse.json({ bangumi: [] });
      }),
    );
    // Should render without throwing
    expect(() => renderWelcomeScreen()).not.toThrow();
    // Quick actions still visible
    expect(screen.getByText("作品で探す")).toBeInTheDocument();
    // Chip section header must be absent when list is empty
    expect(screen.queryByText("人気の作品")).not.toBeInTheDocument();
  });

  it("does not crash on /v1/bangumi/popular network failure", async () => {
    server.use(
      http.get("http://localhost:8000/v1/bangumi/popular", () => {
        return HttpResponse.error();
      }),
    );
    expect(() => renderWelcomeScreen()).not.toThrow();
    expect(screen.getByText("作品で探す")).toBeInTheDocument();
  });

  it("renders tagline in Chinese when zh dict provided", () => {
    renderWelcomeScreen(vi.fn(), zhFull, "zh");
    expect(screen.getByText("探索动漫圣地，踏上巡礼之旅")).toBeInTheDocument();
  });

  it("renders tagline in English when en dict provided", () => {
    renderWelcomeScreen(vi.fn(), enFull, "en");
    expect(
      screen.getByText("Find anime filming locations and plan your pilgrimage route"),
    ).toBeInTheDocument();
  });

  it("renders quick-action labels in Chinese", () => {
    renderWelcomeScreen(vi.fn(), zhFull, "zh");
    expect(screen.getByText("搜索作品")).toBeInTheDocument();
    expect(screen.getByText("附近圣地")).toBeInTheDocument();
    expect(screen.getByText("创建路线")).toBeInTheDocument();
  });

  it("renders quick-action labels in English", () => {
    renderWelcomeScreen(vi.fn(), enFull, "en");
    expect(screen.getByText("Search by anime")).toBeInTheDocument();
    expect(screen.getByText("Nearby spots")).toBeInTheDocument();
    expect(screen.getByText("Plan a route")).toBeInTheDocument();
  });
});
