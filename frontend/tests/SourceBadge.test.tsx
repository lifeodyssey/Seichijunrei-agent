/**
 * SourceBadge unit tests (TDD).
 *
 * AC coverage:
 * - Image URL containing `/user/` renders user-photo badge (📷) -> unit
 * - Other URLs render screenshot badge (🎬) -> unit
 * - Points with episode > 0 show "EP {n}" badge -> unit
 * - Points with episode = 0 or null omit episode badge entirely -> unit
 * - Malformed image URL does not crash badge component -> unit
 * - Episode badge label follows locale -> unit
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SourceBadge from "@/components/generative/SourceBadge";
import defaultDict from "@/lib/dictionaries/ja.json";
import enDict from "@/lib/dictionaries/en.json";
import zhDict from "@/lib/dictionaries/zh.json";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

// ---------------------------------------------------------------------------
// Tests: source badge (URL type detection)
// ---------------------------------------------------------------------------

describe("SourceBadge — source icon", () => {
  it("renders user-photo badge (📷) when screenshot_url contains /user/", () => {
    render(
      <SourceBadge
        screenshotUrl="https://anitabi.cn/images/user/abc123.jpg"
        episode={null}
      />,
    );
    expect(screen.getByText("📷")).toBeInTheDocument();
  });

  it("renders screenshot badge (🎬) when screenshot_url does not contain /user/", () => {
    render(
      <SourceBadge
        screenshotUrl="https://anitabi.cn/images/covers/show123.jpg"
        episode={null}
      />,
    );
    expect(screen.getByText("🎬")).toBeInTheDocument();
  });

  it("renders screenshot badge (🎬) for a plain HTTP URL without /user/", () => {
    render(
      <SourceBadge
        screenshotUrl="https://example.com/screenshot.jpg"
        episode={null}
      />,
    );
    expect(screen.getByText("🎬")).toBeInTheDocument();
  });

  it("renders screenshot badge (🎬) when screenshotUrl is null", () => {
    render(<SourceBadge screenshotUrl={null} episode={null} />);
    expect(screen.getByText("🎬")).toBeInTheDocument();
  });

  it("does not render user-photo badge when /user/ appears only in domain, not path", () => {
    // URL has 'user' in the domain itself, not in the path segment /user/
    render(
      <SourceBadge
        screenshotUrl="https://user-content.cdn.com/images/ep1.jpg"
        episode={null}
      />,
    );
    // Should render screenshot badge because the path does not contain /user/
    expect(screen.getByText("🎬")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: episode badge visibility
// ---------------------------------------------------------------------------

describe("SourceBadge — episode badge", () => {
  it("shows EP badge when episode is a positive integer (e.g., 3)", () => {
    render(
      <SourceBadge screenshotUrl={null} episode={3} />,
    );
    // default locale is ja: "第3話"
    expect(screen.getByText("第3話")).toBeInTheDocument();
  });

  it("shows EP badge when episode is 1", () => {
    render(
      <SourceBadge screenshotUrl={null} episode={1} />,
    );
    expect(screen.getByText("第1話")).toBeInTheDocument();
  });

  it("does not show episode badge when episode is 0", () => {
    render(
      <SourceBadge screenshotUrl={null} episode={0} />,
    );
    // "第0話" should NOT appear
    expect(screen.queryByText("第0話")).toBeNull();
    // More generally, no element containing "話" pattern for ep 0
    const container = screen.queryByTestId("episode-badge");
    expect(container).toBeNull();
  });

  it("does not show episode badge when episode is null", () => {
    render(
      <SourceBadge screenshotUrl={null} episode={null} />,
    );
    expect(screen.queryByTestId("episode-badge")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: malformed URL safety
// ---------------------------------------------------------------------------

describe("SourceBadge — malformed URL safety", () => {
  it("does not crash when screenshotUrl is an empty string", () => {
    expect(() => {
      render(<SourceBadge screenshotUrl="" episode={null} />);
    }).not.toThrow();
    // Should still render screenshot badge fallback
    expect(screen.getByText("🎬")).toBeInTheDocument();
  });

  it("does not crash when screenshotUrl contains unusual characters", () => {
    expect(() => {
      render(
        <SourceBadge
          screenshotUrl="not-a-url://[malformed]/user/file?q=1&r=2"
          episode={null}
        />,
      );
    }).not.toThrow();
  });

  it("does not crash when screenshotUrl is a bare path (no scheme)", () => {
    expect(() => {
      render(<SourceBadge screenshotUrl="/user/avatar.jpg" episode={5} />);
    }).not.toThrow();
    // bare path /user/ → should render user-photo badge
    expect(screen.getByText("📷")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests: locale-aware episode label
// ---------------------------------------------------------------------------

describe("SourceBadge — locale episode label", () => {
  it("uses Japanese episode template (第{ep}話) for ja locale", () => {
    // useDict mock returns ja dict
    render(<SourceBadge screenshotUrl={null} episode={2} />);
    expect(screen.getByText("第2話")).toBeInTheDocument();
  });

  it("formats English episode template (Ep. {ep}) correctly", () => {
    const episodeLabel = enDict.grid.episode.replace("{ep}", "4");
    render(
      <SourceBadge
        screenshotUrl={null}
        episode={4}
        episodeLabel={episodeLabel}
      />,
    );
    expect(screen.getByText(episodeLabel)).toBeInTheDocument();
  });

  it("formats Chinese episode template correctly", () => {
    const episodeLabel = zhDict.grid.episode.replace("{ep}", "7");
    render(
      <SourceBadge
        screenshotUrl={null}
        episode={7}
        episodeLabel={episodeLabel}
      />,
    );
    expect(screen.getByText(episodeLabel)).toBeInTheDocument();
  });
});
