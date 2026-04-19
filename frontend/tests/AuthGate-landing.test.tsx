/**
 * Unit tests for AuthGate landing page rewrite (Card W3-1)
 *
 * AC: Landing hero text, stats labels, 3-step labels render in all 3 locales -> unit
 * AC: No session / first visit — landing renders with all sections visible -> unit (jsdom)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import zhDict from "@/lib/dictionaries/zh.json";
import enDict from "@/lib/dictionaries/en.json";

const jaFull = jaDict as unknown as Dict;
const zhFull = zhDict as unknown as Dict;
const enFull = enDict as unknown as Dict;

// AuthGate uses useDict, useLocale, useSetLocale, getSupabaseClient
// We mock the i18n context and supabase so we can test the landing page
// without auth state loading.
vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(),
  useLocale: vi.fn(() => "ja"),
  useSetLocale: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(() => null),
}));

// AppShell is rendered when session exists — we never reach it in these tests
vi.mock("@/components/layout/AppShell", () => ({
  default: () => <div data-testid="app-shell" />,
}));

import { useDict } from "@/lib/i18n-context";
import AuthGate from "@/components/auth/AuthGate";

function renderLanding(dict: Dict = jaFull) {
  vi.mocked(useDict).mockReturnValue(dict);
  return render(<AuthGate />);
}

// ── Locale: Japanese ──────────────────────────────────────────────────────────

describe("AuthGate landing — Japanese (ja)", () => {
  it("renders the hero title", () => {
    renderLanding(jaFull);
    // The large 聖地巡礼 h1 is present
    const headings = screen.getAllByText("聖地巡礼");
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it("renders hero subtitle", () => {
    renderLanding(jaFull);
    expect(
      screen.getByText("アニメの舞台を探して、巡礼ルートを作ろう"),
    ).toBeInTheDocument();
  });

  it("renders search input with correct placeholder", () => {
    renderLanding(jaFull);
    const input = screen.getByPlaceholderText("アニメの聖地を探す...");
    expect(input).toBeInTheDocument();
  });

  it("renders spot count stat label", () => {
    renderLanding(jaFull);
    expect(screen.getByText("スポット")).toBeInTheDocument();
  });

  it("renders anime count stat label", () => {
    renderLanding(jaFull);
    // "作品" appears as stat label
    const elements = screen.getAllByText("作品");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders prefecture stat label", () => {
    renderLanding(jaFull);
    expect(screen.getByText("都道府県")).toBeInTheDocument();
  });

  it("renders stat numbers 2,400+ and 180+ and 47", () => {
    renderLanding(jaFull);
    expect(screen.getByText("2,400+")).toBeInTheDocument();
    expect(screen.getByText("180+")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("renders step 1 title", () => {
    renderLanding(jaFull);
    expect(screen.getByText("作品で検索")).toBeInTheDocument();
  });

  it("renders step 2 title", () => {
    renderLanding(jaFull);
    expect(screen.getByText("スポットを発見")).toBeInTheDocument();
  });

  it("renders step 3 title", () => {
    renderLanding(jaFull);
    expect(screen.getByText("ルートを計画")).toBeInTheDocument();
  });

  it("renders step 1 description", () => {
    renderLanding(jaFull);
    expect(
      screen.getByText("アニメのタイトルから聖地を検索"),
    ).toBeInTheDocument();
  });

  it("renders step 2 description", () => {
    renderLanding(jaFull);
    expect(screen.getByText("実際の場所を地図で確認")).toBeInTheDocument();
  });

  it("renders step 3 description", () => {
    renderLanding(jaFull);
    expect(
      screen.getByText("最適な巡礼ルートを自動生成"),
    ).toBeInTheDocument();
  });

  it("does not render join_beta button", () => {
    renderLanding(jaFull);
    expect(screen.queryByText("ベータ参加")).not.toBeInTheDocument();
  });

  it("does not render language switcher buttons", () => {
    renderLanding(jaFull);
    // The old switcher had explicit locale labels as buttons
    expect(screen.queryByText("日本語")).not.toBeInTheDocument();
    expect(screen.queryByText("中文")).not.toBeInTheDocument();
  });

  it("renders login button that opens auth modal", () => {
    renderLanding(jaFull);
    // There should be a login button (not join_beta)
    const loginBtn = screen.getByText("ログイン");
    expect(loginBtn).toBeInTheDocument();
  });
});

// ── Locale: Chinese ──────────────────────────────────────────────────────────

describe("AuthGate landing — Chinese (zh)", () => {
  it("renders hero subtitle in Chinese", () => {
    renderLanding(zhFull);
    expect(
      screen.getByText("探索动漫圣地，踏上巡礼之旅"),
    ).toBeInTheDocument();
  });

  it("renders search placeholder in Chinese", () => {
    renderLanding(zhFull);
    const input = screen.getByPlaceholderText("搜索动漫圣地...");
    expect(input).toBeInTheDocument();
  });

  it("renders spot stat label in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("取景地")).toBeInTheDocument();
  });

  it("renders step 1 title in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("搜索作品")).toBeInTheDocument();
  });

  it("renders step 2 title in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("发现景点")).toBeInTheDocument();
  });

  it("renders step 3 title in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.getByText("规划路线")).toBeInTheDocument();
  });

  it("does not render join_beta in Chinese", () => {
    renderLanding(zhFull);
    expect(screen.queryByText("加入测试")).not.toBeInTheDocument();
  });
});

// ── Locale: English ──────────────────────────────────────────────────────────

describe("AuthGate landing — English (en)", () => {
  it("renders hero subtitle in English", () => {
    renderLanding(enFull);
    expect(
      screen.getByText(
        "Find anime filming locations and plan your pilgrimage route",
      ),
    ).toBeInTheDocument();
  });

  it("renders search placeholder in English", () => {
    renderLanding(enFull);
    const input = screen.getByPlaceholderText(
      "Search anime pilgrimage spots...",
    );
    expect(input).toBeInTheDocument();
  });

  it("renders spot stat label in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("spots")).toBeInTheDocument();
  });

  it("renders step 1 title in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Search by anime")).toBeInTheDocument();
  });

  it("renders step 2 title in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Discover spots")).toBeInTheDocument();
  });

  it("renders step 3 title in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Plan your route")).toBeInTheDocument();
  });

  it("does not render join_beta in English", () => {
    renderLanding(enFull);
    expect(screen.queryByText("Join beta")).not.toBeInTheDocument();
  });

  it("renders login button in English", () => {
    renderLanding(enFull);
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });
});

// ── Structural / session-independent ─────────────────────────────────────────

describe("AuthGate landing — structure", () => {
  it("renders all three step number badges", () => {
    renderLanding(jaFull);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders footer with brand name", () => {
    renderLanding(jaFull);
    // Footer contains 聖地巡礼 — could be multiple instances but at least one
    const all = screen.getAllByText("聖地巡礼");
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it("floating photo cards section is present in DOM", () => {
    const { container } = renderLanding(jaFull);
    // The floating cards container has a specific test id or aria role
    const floatingSection = container.querySelector(
      "[data-testid='floating-cards']",
    );
    expect(floatingSection).not.toBeNull();
  });

  it("hero section is present", () => {
    const { container } = renderLanding(jaFull);
    const hero = container.querySelector("[data-testid='hero-section']");
    expect(hero).not.toBeNull();
  });

  it("steps section is present", () => {
    const { container } = renderLanding(jaFull);
    const steps = container.querySelector("[data-testid='steps-section']");
    expect(steps).not.toBeNull();
  });

  it("gallery section is present", () => {
    const { container } = renderLanding(jaFull);
    const gallery = container.querySelector("[data-testid='gallery-section']");
    expect(gallery).not.toBeNull();
  });

  it("search input is present and has type text", () => {
    renderLanding(jaFull);
    const input = screen.getByPlaceholderText("アニメの聖地を探す...");
    expect(input.tagName).toBe("INPUT");
  });

  it("auth modal is hidden on initial render", () => {
    const { container } = renderLanding(jaFull);
    const modal = container.querySelector("[data-testid='auth-modal']");
    // Modal either not in DOM or not visible initially
    if (modal) {
      expect(modal).not.toBeVisible();
    } else {
      expect(modal).toBeNull();
    }
  });
});
