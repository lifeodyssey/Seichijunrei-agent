/**
 * Card W3-2: Login modal cleanup
 *
 * AC: Login modal shows "ログイン" title, descriptive subtitle, "ログインリンクを送信" button -> unit
 * AC: Button text is sentence-case, not ALL-CAPS -> unit
 * AC: No "Internal beta" text anywhere in modal -> unit
 * AC: Auth not configured — modal shows configuration error message -> unit
 * AC: Magic link send failure — error message displayed in modal -> unit
 * AC: Modal title, subtitle, button text render correctly in ja, zh, en -> unit
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { Dict } from "@/lib/i18n";
import jaDict from "@/lib/dictionaries/ja.json";
import zhDict from "@/lib/dictionaries/zh.json";
import enDict from "@/lib/dictionaries/en.json";

// --- i18n context mocks ---
vi.mock("@/lib/i18n-context", () => ({
  useDict: vi.fn(),
  useLocale: vi.fn(),
  useSetLocale: vi.fn(),
}));

// --- Supabase mock ---
vi.mock("@/lib/supabase", () => ({
  getSupabaseClient: vi.fn(),
}));

// AppShell not under test
vi.mock("@/components/layout/AppShell", () => ({
  default: () => <div data-testid="app-shell" />,
}));

// Stub IntersectionObserver (used for scroll-reveal)
class MockIntersectionObserver {
  constructor(_cb: IntersectionObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

// ──────────────────────────────────────────────
// Helper: render AuthGate, wait past loading, open modal
// ──────────────────────────────────────────────
async function renderAndOpenModal(dict: Dict) {
  // Import after mocks are set up
  const { default: AuthGate } = await import("@/components/auth/AuthGate");
  const { container } = render(<AuthGate />);

  // Wait for loading state to resolve (getSession resolves, loading → false)
  await waitFor(() => {
    expect(
      screen.queryByText(dict.auth.loading),
    ).not.toBeInTheDocument();
  });

  // Click the header login link to open the modal
  const loginTrigger = screen.getByText(dict.landing_hero.login);
  await act(async () => {
    fireEvent.click(loginTrigger);
  });

  return container;
}

// ──────────────────────────────────────────────
// Setup helpers
// ──────────────────────────────────────────────
function makeSupabaseClient(signInResult: { error: null | { message: string } } = { error: null }) {
  const mockUpsert = vi.fn().mockResolvedValue({});
  const mockSignInWithOtp = vi.fn().mockResolvedValue(signInResult);
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithOtp: mockSignInWithOtp,
    },
    from: vi.fn(() => ({ upsert: mockUpsert })),
    _mocks: { mockUpsert, mockSignInWithOtp },
  };
}

async function setupMocks(dict: Dict, supabaseClient: ReturnType<typeof makeSupabaseClient> | null) {
  const { useDict, useLocale, useSetLocale } = await import("@/lib/i18n-context");
  const { getSupabaseClient } = await import("@/lib/supabase");

  (useDict as ReturnType<typeof vi.fn>).mockReturnValue(dict);
  (useLocale as ReturnType<typeof vi.fn>).mockReturnValue("ja");
  (useSetLocale as ReturnType<typeof vi.fn>).mockReturnValue(vi.fn());
  (getSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(supabaseClient);
}

// ──────────────────────────────────────────────
// AC: Title, subtitle, button — Japanese
// ──────────────────────────────────────────────
describe("Login modal — Japanese (ja)", () => {
  const dict = jaDict as unknown as Dict;

  it("shows ログイン as the modal title -> unit", async () => {
    await setupMocks(dict, makeSupabaseClient());
    await renderAndOpenModal(dict);
    expect(screen.getByRole("heading", { name: "ログイン" })).toBeInTheDocument();
  });

  it("shows descriptive subtitle (not 内部テスト版) -> unit", async () => {
    await setupMocks(dict, makeSupabaseClient());
    await renderAndOpenModal(dict);
    expect(
      screen.getByText("メールアドレスを入力すると、ログインリンクをお送りします"),
    ).toBeInTheDocument();
  });

  it("button text is ログインリンクを送信 -> unit", async () => {
    await setupMocks(dict, makeSupabaseClient());
    await renderAndOpenModal(dict);
    expect(
      screen.getByRole("button", { name: "ログインリンクを送信" }),
    ).toBeInTheDocument();
  });

  it("submit button does not have uppercase CSS class -> unit", async () => {
    await setupMocks(dict, makeSupabaseClient());
    await renderAndOpenModal(dict);
    const btn = screen.getByRole("button", { name: "ログインリンクを送信" });
    expect(btn.className).not.toContain("uppercase");
  });

  it('no "内部テスト版" or "internal beta" text in modal -> unit', async () => {
    await setupMocks(dict, makeSupabaseClient());
    await renderAndOpenModal(dict);
    expect(screen.queryByText(/内部テスト版/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/internal beta/i)).not.toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────
// AC: Auth not configured — shows config error
// ──────────────────────────────────────────────
describe("Login modal — auth not configured", () => {
  const dict = jaDict as unknown as Dict;

  it("shows not_configured error message when auth is unconfigured -> unit", async () => {
    // When supabase is null, loading starts false immediately
    const { useDict, useLocale, useSetLocale } = await import("@/lib/i18n-context");
    const { getSupabaseClient } = await import("@/lib/supabase");

    (useDict as ReturnType<typeof vi.fn>).mockReturnValue(dict);
    (useLocale as ReturnType<typeof vi.fn>).mockReturnValue("ja");
    (useSetLocale as ReturnType<typeof vi.fn>).mockReturnValue(vi.fn());
    (getSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const { default: AuthGate } = await import("@/components/auth/AuthGate");
    render(<AuthGate />);

    // No loading state when unconfigured — modal trigger is visible immediately
    const loginTrigger = screen.getByText(dict.landing_hero.login);
    await act(async () => {
      fireEvent.click(loginTrigger);
    });

    expect(screen.getByText(dict.auth.not_configured)).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────
// AC: Magic link send failure — error displayed
// ──────────────────────────────────────────────
describe("Login modal — send failure", () => {
  const dict = jaDict as unknown as Dict;

  it("displays error message when signInWithOtp fails -> unit", async () => {
    const client = makeSupabaseClient({ error: { message: "rate limited" } });
    await setupMocks(dict, client);
    await renderAndOpenModal(dict);

    const emailInput = screen.getByRole("textbox", { name: /メール/i });
    fireEvent.change(emailInput, { target: { value: "test@example.com" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ログインリンクを送信" }));
    });

    await waitFor(() => {
      expect(screen.getByText(/rate limited/i)).toBeInTheDocument();
    });
  });
});

// ──────────────────────────────────────────────
// AC: i18n — Chinese (zh)
// ──────────────────────────────────────────────
describe("Login modal — Chinese (zh)", () => {
  const dict = zhDict as unknown as Dict;

  async function setupZh() {
    const { useDict, useLocale, useSetLocale } = await import("@/lib/i18n-context");
    const { getSupabaseClient } = await import("@/lib/supabase");
    (useDict as ReturnType<typeof vi.fn>).mockReturnValue(dict);
    (useLocale as ReturnType<typeof vi.fn>).mockReturnValue("zh");
    (useSetLocale as ReturnType<typeof vi.fn>).mockReturnValue(vi.fn());
    (getSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(makeSupabaseClient());
  }

  it("shows 登录 as modal title -> unit", async () => {
    await setupZh();
    await renderAndOpenModal(dict);
    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
  });

  it("shows Chinese subtitle -> unit", async () => {
    await setupZh();
    await renderAndOpenModal(dict);
    expect(screen.getByText("输入邮箱地址获取登录链接")).toBeInTheDocument();
  });

  it("button text is 发送登录链接 -> unit", async () => {
    await setupZh();
    await renderAndOpenModal(dict);
    expect(
      screen.getByRole("button", { name: "发送登录链接" }),
    ).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────
// AC: i18n — English (en)
// ──────────────────────────────────────────────
describe("Login modal — English (en)", () => {
  const dict = enDict as unknown as Dict;

  async function setupEn() {
    const { useDict, useLocale, useSetLocale } = await import("@/lib/i18n-context");
    const { getSupabaseClient } = await import("@/lib/supabase");
    (useDict as ReturnType<typeof vi.fn>).mockReturnValue(dict);
    (useLocale as ReturnType<typeof vi.fn>).mockReturnValue("en");
    (useSetLocale as ReturnType<typeof vi.fn>).mockReturnValue(vi.fn());
    (getSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(makeSupabaseClient());
  }

  it("shows Log in as modal title -> unit", async () => {
    await setupEn();
    await renderAndOpenModal(dict);
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("shows English subtitle -> unit", async () => {
    await setupEn();
    await renderAndOpenModal(dict);
    expect(
      screen.getByText("Enter your email to receive a login link"),
    ).toBeInTheDocument();
  });

  it("button text is Send login link -> unit", async () => {
    await setupEn();
    await renderAndOpenModal(dict);
    expect(
      screen.getByRole("button", { name: "Send login link" }),
    ).toBeInTheDocument();
  });
});
