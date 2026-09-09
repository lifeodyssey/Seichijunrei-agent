/**
 * @vitest-environment jsdom
 *
 * Issue #447 review (merged-state blocker): #445 put `/v1/photo-search` on the
 * anonymous allowlist, so once both land the armed gate challenges photo
 * uploads too. Photo has no challenge UI of its own, so it must (a) wait for
 * the widget's token like chat does, and (b) say "redo the check" rather than
 * "photo search failed" when the edge rejects it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatActionsProvider } from "../../../src/features/chat/ChatActions";
import { PhotoSearchUpload } from "../../../src/features/chat/components/PhotoSearchUpload";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { sessionHeaders } from "../../../src/features/chat/session-headers";
import {
  clearTurnstileToken,
  rememberTurnstileToken,
} from "../../../src/lib/turnstile/token-store";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/lib/runtime-config/runtime-config";
import { TEST_ORIGIN } from "../../msw/fixtures";
import { server } from "../../msw/node";
import { makeJpegWithExif } from "../shiori/_jpeg-fixtures";

const dict = chatDictFor("ja");
const URL = `${TEST_ORIGIN}/v1/photo-search`;
const SITE_KEY = "0x4AAAAAAAsitekey24chars";
const OK_ENVELOPE = { success: true, status: "ok", intent: "clarify", offer_id: "offer-1", data: {} };
const CHALLENGED = {
  error: { code: "turnstile_required", message: "Turnstile verification required.", retryable: true },
};

beforeEach(() => {
  clearTurnstileToken();
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, turnstileSiteKey: SITE_KEY });
});

afterEach(() => {
  cleanup();
  clearTurnstileToken();
});

function renderUpload() {
  render(
    <ChatActionsProvider actions={{ send: vi.fn(), regenerate: vi.fn() }}>
      <PhotoSearchUpload dict={dict} baseUrl={TEST_ORIGIN} context={{ locale: "ja" }} />
    </ChatActionsProvider>,
  );
}

function upload() {
  const bytes = makeJpegWithExif() as Uint8Array<ArrayBuffer>;
  const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText(dict.photo.upload), { target: { files: [file] } });
}

/** Record the token each upload carried (null when it went out unchallenged). */
function tokenSpy(seen: (string | null)[], body: object = OK_ENVELOPE, status = 200) {
  server.use(
    http.post(URL, ({ request }) => {
      seen.push(request.headers.get("cf-turnstile-response"));
      return HttpResponse.json(body, { status });
    }),
  );
}

/** Drain the microtask queue — enough turns that any promise NOT waiting on
 * the widget would have settled. Deterministic: no clock, no timers. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

describe("the shared header path waits for the widget", () => {
  // Pinned at the header layer, not through the component: an upload spends
  // several async turns on EXIF-stripping and base64 before its headers are
  // read, so a token solved during that window would be picked up even by a
  // transport that never waits — the component-level test below cannot tell
  // the two apart, and a mutation that drops the wait survives it.
  it("does not resolve an anonymous request's headers until a token exists", async () => {
    let wasSettled = false;
    const pending = sessionHeaders();
    void pending.then(() => { wasSettled = true; });
    await flush();
    expect(wasSettled).toBe(false);
    rememberTurnstileToken("late-token");
    expect(await pending).toEqual({ "cf-turnstile-response": "late-token" });
  });

  it("resolves headers straight away when this build renders no widget", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, DEFAULT_RUNTIME_CONFIG);
    vi.stubEnv("DEV", false);
    await expect(sessionHeaders()).resolves.toEqual({});
  });

});

describe("an upload waits for the challenge instead of walking into a 403", () => {
  it("holds the request until the widget has solved, then carries the token", async () => {
    const seen: (string | null)[] = [];
    tokenSpy(seen);
    renderUpload();
    upload();
    await flush();
    expect(seen).toEqual([]);
    rememberTurnstileToken("photo-token");
    await waitFor(() => {
      expect(seen).toEqual(["photo-token"]);
    });
  });

  it("sends immediately when a token is already held", async () => {
    const seen: (string | null)[] = [];
    tokenSpy(seen);
    rememberTurnstileToken("held-token");
    renderUpload();
    upload();
    await waitFor(() => {
      expect(seen).toEqual(["held-token"]);
    });
  });

  it("does not wait at all when this build renders no widget", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, DEFAULT_RUNTIME_CONFIG);
    vi.stubEnv("DEV", false);
    const seen: (string | null)[] = [];
    tokenSpy(seen);
    renderUpload();
    upload();
    await waitFor(() => {
      expect(seen).toEqual([null]);
    });
  });
});

describe("a challenged upload is not a broken upload", () => {
  it("shows the redo-the-check copy, never the photo failure copy", async () => {
    rememberTurnstileToken("stale-token");
    tokenSpy([], CHALLENGED, 403);
    renderUpload();
    upload();
    expect(await screen.findByText(dict.turnstile.failed, { exact: false })).toBeTruthy();
    expect(screen.queryByText(dict.photo.failed, { exact: false })).toBeNull();
  });

  it("still reports a genuine backend failure as a photo failure", async () => {
    rememberTurnstileToken("good-token");
    tokenSpy([], { error: { code: "photo_search_unavailable" } }, 500);
    renderUpload();
    upload();
    expect(await screen.findByText(dict.photo.failed, { exact: false })).toBeTruthy();
    expect(screen.queryByText(dict.turnstile.failed, { exact: false })).toBeNull();
  });

  it("keeps the retry affordance on a challenged upload", async () => {
    rememberTurnstileToken("stale-token");
    tokenSpy([], CHALLENGED, 403);
    renderUpload();
    upload();
    await screen.findByText(dict.turnstile.failed, { exact: false });
    expect(screen.getByRole("button", { name: dict.photo.retry })).toBeTruthy();
  });
});
