/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSidebar } from "../../../src/features/chat/components/ChatSidebar";
import { ChatReturnTargetProvider } from "../../../src/features/chat/ChatReturnTarget";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { conversationsListHandler } from "../../msw/chat-handlers";
import type { ConversationListRowFixture } from "../../msw/chat-handlers";
import { server } from "../../msw/node";
import { AppRouterContext } from "../_router";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn() }));
vi.mock("../../../src/lib/auth/auth-session", () => ({ authHeaders }));

const ja = chatDictFor("ja");

const ROWS: readonly ConversationListRowFixture[] = [
  { session_id: "s-1", title: "Kamakura, by the sea", first_query: "Slam Dunk spots", created_at: null, updated_at: null },
  { session_id: "s-2", title: null, first_query: "君の名は。の聖地", created_at: null, updated_at: null },
];

afterEach(cleanup);

function renderSidebar(status: "anonymous" | "authenticated" = "authenticated", activeSessionId?: string, sessionId?: string, seeded?: QueryClient) {
  const client = seeded ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AppRouterContext>
      <ChatReturnTargetProvider sessionIdOf={() => sessionId}>
        <LocaleProvider><QueryClientProvider client={client}>
          <ChatSidebar dict={ja} status={status} baseUrl={TEST_ORIGIN} activeSessionId={activeSessionId} />
        </QueryClientProvider></LocaleProvider>
      </ChatReturnTargetProvider>
    </AppRouterContext>,
  );
}

describe("ChatSidebar chrome", () => {
  it("locks up the torii, the localized brand, and the tagline", () => {
    authHeaders.mockResolvedValue({});
    renderSidebar();
    /* The brand lockup and the signed-in card both carry brand + tagline. */
    expect(screen.getAllByText(ja.appbar.brand).length).toBeGreaterThan(0);
    expect(screen.getAllByText(ja.brandTagline).length).toBeGreaterThan(0);
    expect(screen.getByAltText("").getAttribute("src")).toBe("/images/landing/torii.svg");
  });

  it("makes the gold pill a document link to a fresh /chat", () => {
    authHeaders.mockResolvedValue({});
    renderSidebar();
    const link = screen.getByRole("link", { name: ja.newJourney });
    expect(link.getAttribute("href")).toBe("/chat");
  });

  it("carries the live conversation to settings so its back link returns (#1337)", () => {
    authHeaders.mockResolvedValue({});
    renderSidebar("anonymous", undefined, "sess-1337");
    expect(screen.getByRole("link", { name: ja.appbar.settings }).getAttribute("href")).toBe("/settings?session=sess-1337");
  });
});

describe("ChatSidebar RECENT rows", () => {
  it("renders one row per conversation, title falling back to the first query", async () => {
    authHeaders.mockResolvedValue({ Authorization: "Bearer jwt-xyz" });
    let seen: string | null = "unset";
    server.use(conversationsListHandler(ROWS, (request) => { seen = request.headers.get("authorization"); }));
    renderSidebar();
    const first = await screen.findByText("Kamakura, by the sea");
    expect(first.closest("a")?.getAttribute("href")).toBe("/chat?session=s-1");
    expect(screen.getByText("Slam Dunk spots")).toBeTruthy();
    const fallback = screen.getByText("君の名は。の聖地");
    expect(fallback.closest("a")?.getAttribute("href")).toBe("/chat?session=s-2");
    expect(seen).toBe("Bearer jwt-xyz");
  });

  it("marks the active session's row", async () => {
    authHeaders.mockResolvedValue({});
    server.use(conversationsListHandler(ROWS));
    renderSidebar("authenticated", "s-1");
    const active = await screen.findByText("Kamakura, by the sea");
    expect(active.closest("a")?.className).toContain("bg-primary-soft");
  });

  it("renders no rows at all when the list is empty", async () => {
    authHeaders.mockResolvedValue({});
    server.use(conversationsListHandler([]));
    renderSidebar();
    await waitFor(() => { expect(screen.queryByRole("navigation")).toBeNull(); });
    expect(screen.queryByText(ja.recentLabel)).toBeNull();
  });

  it("stays idle — and never fetches — while signed out", async () => {
    authHeaders.mockResolvedValue({});
    let called = false;
    server.use(conversationsListHandler(ROWS, () => { called = true; }));
    renderSidebar("anonymous");
    /* Flush past the auth-header await so a would-be fetch could land. */
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(ja.recentLabel)).toBeNull();
    expect(called).toBe(false);
  });

  it("hides a previous session's cached list from the signed-out visitor", async () => {
    authHeaders.mockResolvedValue({});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["chat", "conversations", TEST_ORIGIN], [{ id: "s-9", title: "Previous session", subtitle: "cached" }]);
    renderSidebar("anonymous", undefined, undefined, client);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("Previous session")).toBeNull();
    expect(screen.queryByText(ja.recentLabel)).toBeNull();
  });
});

describe("ChatSidebar identity card", () => {
  it("gives an anonymous visitor the login affordance, never a stand-in avatar", () => {
    authHeaders.mockResolvedValue({});
    renderSidebar("anonymous");
    expect(screen.getByRole("button", { name: ja.appbar.login })).toBeTruthy();
    expect(screen.queryByRole("img", { name: ja.appbar.signedIn })).toBeNull();
  });

  it("marks the signed-in visitor's card with the labelled avatar", () => {
    authHeaders.mockResolvedValue({});
    renderSidebar("authenticated");
    expect(screen.getByRole("img", { name: ja.appbar.signedIn })).toBeTruthy();
    expect(screen.queryByRole("button", { name: ja.appbar.login })).toBeNull();
  });
});
