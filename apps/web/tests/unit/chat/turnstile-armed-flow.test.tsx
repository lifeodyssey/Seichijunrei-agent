/** @vitest-environment jsdom */
import { http, HttpResponse } from "msw";
import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTurnstileToken } from "../../../src/lib/turnstile/token-store";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/lib/runtime-config/runtime-config";
import { server } from "../../msw/node";
import { expectAbandonedRequests } from "../../msw/in-flight-requests";
import { armedChatHandler } from "../../msw/chat-handlers";
import { setLanguages } from "../_i18n";
import { chatSearch, renderChatEntry } from "./_chat-page";

const { getAuthToken } = vi.hoisted(() => ({ getAuthToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../src/lib/auth/auth-session", () => ({
  getAuthToken,
  clearAuthToken: () => undefined,
  authHeaders: () => Promise.resolve({}),
}));

const SITE_KEY = "0x4AAAAAAAsitekey24chars";
const ANSWER = "宇治の聖地を2件、徒歩ルートにまとめました。";

async function solve(token: string): Promise<void> {
  await waitFor(() => { expect(window.onAnimichiTurnstile).toBeTypeOf("function"); });
  await act(async () => { window.onAnimichiTurnstile?.(token); await Promise.resolve(); });
}

beforeEach(() => {
  setLanguages(["ja"]);
  clearTurnstileToken();
  getAuthToken.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, turnstileSiteKey: SITE_KEY });
});

describe("?q= after the entry verification", () => {
  it("does not mount or send before the server accepts the token", async () => {
    const seen: (string | null)[] = [];
    server.use(http.post("*/v1/turnstile/verify", () => new HttpResponse(null, { status: 403 })));
    server.use(armedChatHandler("search", seen));
    renderChatEntry(chatSearch({ q: "ユーフォ" }));
    await solve("rejected-token");
    await screen.findByRole("button", { name: "もう一度ためす" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(seen).toEqual([]);
  });

  it("auto-sends once after entry succeeds and carries the verified token", async () => {
    const seen: (string | null)[] = [];
    server.use(http.post("*/v1/turnstile/verify", () => new HttpResponse(null, { status: 204 })));
    server.use(armedChatHandler("search", seen));
    renderChatEntry(chatSearch({ q: "ユーフォ" }));
    await solve("hero-token");
    expect(await screen.findByText(ANSWER)).toBeTruthy();
    expect(seen).toEqual(["hero-token"]);
  });

  it("keeps the chat absent while verification is pending", async () => {
    expectAbandonedRequests(1);
    server.use(http.post("*/v1/turnstile/verify", () => new Promise(() => undefined)));
    renderChatEntry(chatSearch({ q: "ユーフォ" }));
    await solve("pending-token");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
