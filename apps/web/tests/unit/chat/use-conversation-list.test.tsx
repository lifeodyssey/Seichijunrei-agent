/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useConversationList } from "../../../src/features/chat/use-conversation-list";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { conversationsListHandler } from "../../msw/chat-handlers";
import type { ConversationListRowFixture } from "../../msw/chat-handlers";
import { server } from "../../msw/node";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn() }));
vi.mock("../../../src/lib/auth/auth-session", () => ({ authHeaders }));

function wrapper({ children }: Readonly<{ children: ReactNode }>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderList(authenticated: boolean) {
  return renderHook(() => useConversationList(TEST_ORIGIN, authenticated), { wrapper });
}

const ROWS: readonly ConversationListRowFixture[] = [
  { session_id: "s-1", title: "Kamakura, by the sea", first_query: "Slam Dunk spots", created_at: null, updated_at: null },
  { session_id: "s-2", title: null, first_query: "君の名は。の聖地", created_at: "2026-08-01T00:00:00Z", updated_at: null },
];

describe("useConversationList", () => {
  it("stays idle and fetches nothing while signed out", () => {
    authHeaders.mockResolvedValue({});
    let called = false;
    server.use(conversationsListHandler(ROWS, () => { called = true; }));
    const view = renderList(false);
    expect(view.result.current.status).toBe("idle");
    expect(view.result.current.conversations).toEqual([]);
    expect(called).toBe(false);
  });

  it("lists summaries with the title falling back to the first query", async () => {
    authHeaders.mockResolvedValue({});
    server.use(conversationsListHandler(ROWS));
    const view = renderList(true);
    await waitFor(() => { expect(view.result.current.status).toBe("success"); });
    expect(view.result.current.conversations).toEqual([
      { id: "s-1", title: "Kamakura, by the sea", subtitle: "Slam Dunk spots" },
      { id: "s-2", title: "君の名は。の聖地", subtitle: "" },
    ]);
  });

  it("forwards the bearer token on the request", async () => {
    authHeaders.mockResolvedValue({ Authorization: "Bearer jwt-xyz" });
    let seen: string | null = "unset";
    server.use(conversationsListHandler(ROWS, (request) => { seen = request.headers.get("authorization"); }));
    const view = renderList(true);
    await waitFor(() => { expect(view.result.current.status).toBe("success"); });
    expect(seen).toBe("Bearer jwt-xyz");
  });

  it("reports a failed call as the error status with no fabricated rows", async () => {
    authHeaders.mockResolvedValue({});
    server.use(http.get(`${TEST_ORIGIN}/v1/conversations`, () => new HttpResponse(null, { status: 500 })));
    const view = renderList(true);
    await waitFor(() => { expect(view.result.current.status).toBe("error"); });
    expect(view.result.current.conversations).toEqual([]);
  });
});
