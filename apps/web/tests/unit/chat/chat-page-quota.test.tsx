/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { QUOTA_BANNER_ID } from "../../../src/features/chat/components/ErrorStates/QuotaExhausted";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { setLanguages } from "../_i18n";
import { chatTurnsAnswered } from "../../msw/chat-answered";
import {
  chatQuotaExhaustedHandler,
  chatStreamHandler,
  chatStreamPatchedHandler,
  searchResultsPatch,
} from "../../msw/chat-handlers";
import { server } from "../../msw/node";
import { chatSearch, renderChatPage } from "./_chat-page";

const ja = chatDictFor("ja");
const states = ja.errorStates;
const DRAFT_KEY = "animichi:chat-draft";
/** Far enough ahead that the auto-release timer never fires inside a test. */
const RESETS_AT = "2099-01-01T00:00:00Z";
/** Computed here, not via the production formatter, so the copy is really pinned. */
const RESET_TIME = new Intl.DateTimeFormat("ja", { hour: "numeric", minute: "2-digit" })
  .format(Date.parse(RESETS_AT));

beforeEach(() => {
  setLanguages(["ja"]);
  sessionStorage.clear();
});

function field(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>("textbox");
}

function sendText(text: string) {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: ja.send }));
}

async function exhaustQuota(resetsAt?: string) {
  server.use(chatQuotaExhaustedHandler(resetsAt));
  const rejected = chatTurnsAnswered();
  renderChatPage();
  sendText("ユーフォ");
  // Wait on the rejection actually being served, not on a wall clock: under a
  // loaded runner the turn can leave the browser later than any `findBy*`
  // budget, and abandoning it mid-flight leaks it into the next case (#1503).
  await rejected;
  // The live region mounts empty and is filled once the rejection lands, so
  // waiting on `role="status"` alone returns before the notice has any copy.
  // The login CTA only exists inside the rendered quota banner.
  await screen.findByRole("button", { name: states.d12Login });
}

describe("D12 anonymous daily message quota", () => {
  it("explains this visitor's own limit, not an expiry and not the shared budget", async () => {
    await exhaustQuota();
    expect(screen.getByRole("status").textContent).toContain(states.d12Message);
    expect(screen.queryByText(states.d8Message)).toBeNull();
    expect(screen.queryByText(states.d11Message)).toBeNull();
    expect(screen.getByText("ユーフォ")).toBeTruthy();
  });

  it("names the reset instant when the rejection carried one", async () => {
    await exhaustQuota(RESETS_AT);
    const notice = screen.getByRole("status").textContent;
    expect(notice).toContain(RESET_TIME);
    expect(notice).not.toContain("{time}");
  });

  it("offers login as the way forward instead of a dead end", async () => {
    await exhaustQuota();
    expect(screen.getByRole("button", { name: states.d12Login })).toBeTruthy();
    expect(screen.queryByRole("button", { name: states.d4Retry })).toBeNull();
  });

  it("withholds the send button even once the visitor has typed a fresh draft", async () => {
    await exhaustQuota();
    fireEvent.change(field(), { target: { value: "宇治にいきたい" } });
    expect(screen.getByRole("button", { name: ja.send }).hasAttribute("disabled")).toBe(true);
    expect(field().hasAttribute("disabled")).toBe(false);
    expect(field().placeholder).toBe(states.d12InputHint);
  });

  it("keeps a draft typed after the limit landed, rather than eating it", async () => {
    await exhaustQuota();
    fireEvent.change(field(), { target: { value: "宇治にいきたい" } });
    fireEvent.submit(field());
    expect(field().value).toBe("宇治にいきたい");
  });

  it("parks the draft in session storage so the login round-trip cannot eat it", async () => {
    await exhaustQuota();
    fireEvent.change(field(), { target: { value: "宇治にいきたい" } });
    // The magic-link return is a fresh document: only stored state comes back.
    expect(sessionStorage.getItem(DRAFT_KEY)).toBe("宇治にいきたい");
  });
});

describe("an anonymous identity still inside its quota", () => {
  it("shows no quota UI at all and leaves the composer unlocked", async () => {
    server.use(chatStreamHandler("search"));
    renderChatPage();
    sendText("ユーフォ");
    expect(await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeTruthy();
    expect(screen.queryByText(states.d12Message)).toBeNull();
    expect(screen.queryByRole("button", { name: states.d12Login })).toBeNull();
    expect(field().placeholder).toBe(ja.inputPlaceholder);
  });

  it("starts a brand-new identity at full quota: composer live, no notice", () => {
    renderChatPage();
    fireEvent.change(field(), { target: { value: "ユーフォ" } });
    expect(screen.getByRole("button", { name: ja.send }).hasAttribute("disabled")).toBe(false);
    expect(field().placeholder).toBe(ja.inputPlaceholder);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("restores a parked draft so a returning visitor never retypes", () => {
    sessionStorage.setItem(DRAFT_KEY, "宇治にいきたい");
    renderChatPage();
    expect(field().value).toBe("宇治にいきたい");
    expect(screen.getByRole("button", { name: ja.send }).hasAttribute("disabled")).toBe(false);
  });
});

describe("D12 arriving on an E2 recompute turn", () => {
  it("surfaces the quota banner instead of being masked as a tray failure", async () => {
    server.use(chatStreamPatchedHandler("search", searchResultsPatch, { once: true }));
    renderChatPage(chatSearch({ q: "ユーフォ" }));
    await screen.findByText("宇治橋");
    fireEvent.click(screen.getByRole("checkbox", { name: `${ja.search.select}: 宇治橋` }));
    fireEvent.click(screen.getByRole("checkbox", { name: `${ja.search.select}: 宇治神社` }));
    server.use(chatQuotaExhaustedHandler(RESETS_AT));
    fireEvent.click(screen.getByRole("button", { name: ja.search.trayAction }));
    // Masked as a tray failure this would be silent, and the tray's own retry
    // would re-send the same bypass into the same exhausted quota forever.
    expect(await screen.findByRole("button", { name: states.d12Login })).toBeTruthy();
    const banner = document.querySelector(".chat-quota-exhausted");
    expect(banner?.getAttribute("role")).toBe("status");
    expect(banner?.getAttribute("id")).toBe(QUOTA_BANNER_ID);
    expect(banner?.textContent).toContain(RESET_TIME);
  });
});
