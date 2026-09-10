import test from "node:test";
import assert from "node:assert/strict";
import { ByokProbe, PROBE_RESPONSE_CAP_BYTES, cappedResponse } from "../src/agent/byok/byok-probe.ts";
import type { ByokCredentialParts } from "../src/agent/byok/byok-credential.ts";
import { byokCredentialIn } from "../src/agent/byok/byok-headers.ts";

// W2-3 (#1289) — the probe's failure taxonomy, ported from
// `apps/agent/src/animichi/agents/byok_probe.py` +
// `interfaces/services/byok_probe.py`. It is deliberately COARSE: only the two
// auth statuses and the two "the model refused the image" statuses are told
// apart, because a finer answer turns the probe into a reachability oracle for
// a caller-chosen endpoint.
//
// test-type: unit (no network — every upstream answer is scripted).

const FIXTURE_KEY = "byok-test-key-0000";

/** The upstream a probe talks to, scripted down to the wire format: pi's
 * openai-completions adapter streams, so a SUCCESS has to be real SSE. */
function scriptedUpstream(status: number, body: string, contentType: string): typeof globalThis.fetch {
  return () => Promise.resolve(new Response(body, {
    status,
    headers: { "content-type": contentType },
  }));
}

function failingUpstream(status: number): typeof globalThis.fetch {
  return scriptedUpstream(status, JSON.stringify({ error: { message: "no" } }), "application/json");
}

const CHUNK = {
  id: "1",
  object: "chat.completion.chunk",
  created: 0,
  model: "gpt-4o-mini",
  choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }],
};
const FINAL = {
  id: "1",
  object: "chat.completion.chunk",
  created: 0,
  model: "gpt-4o-mini",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
};

function answeringUpstream(): typeof globalThis.fetch {
  const sse = `data: ${JSON.stringify(CHUNK)}\n\ndata: ${JSON.stringify(FINAL)}\n\ndata: [DONE]\n\n`;
  return scriptedUpstream(200, sse, "text/event-stream");
}

function credential(): ByokCredentialParts {
  const parsed = byokCredentialIn(new Headers({
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": FIXTURE_KEY,
    "X-BYOK-Model": "gpt-4o-mini",
    "X-BYOK-Base-Url": "https://api.openai.com/v1",
  }));
  assert.ok(parsed !== null, "the fixture headers must parse");
  return parsed;
}

function probeAgainst(inner: typeof globalThis.fetch) {
  return new ByokProbe({ egress: { inner } }).run(credential());
}

// ── the one actionable answer ──────────────────────────────────────────────

const REJECTING_STATUSES = [401, 403];

for (const status of REJECTING_STATUSES) {
  void test(`a ${String(status)} names the credential as the problem`, async () => {
    assert.deepEqual(await probeAgainst(failingUpstream(status)), {
      vision: false,
      reachable: false,
      error_code: "byok_credential_rejected",
    });
  });
}

// ── reachable, but this model will not take an image ───────────────────────

const IMAGE_REFUSING_STATUSES = [400, 422];

for (const status of IMAGE_REFUSING_STATUSES) {
  void test(`a ${String(status)} means reachable without vision, not a broken key`, async () => {
    assert.deepEqual(await probeAgainst(failingUpstream(status)), {
      vision: false,
      reachable: true,
      error_code: null,
    });
  });
}

// ── everything else collapses to one answer ────────────────────────────────

const COLLAPSING_STATUSES = [404, 429, 500, 502];

for (const status of COLLAPSING_STATUSES) {
  void test(`a ${String(status)} collapses to provider_unreachable`, async () => {
    assert.deepEqual(await probeAgainst(failingUpstream(status)), {
      vision: false,
      reachable: false,
      error_code: "provider_unreachable",
    });
  });
}

void test("a transport failure collapses to provider_unreachable rather than escaping", async () => {
  const broken: typeof globalThis.fetch = () => Promise.reject(new Error("connection refused"));
  assert.deepEqual(await probeAgainst(broken), {
    vision: false,
    reachable: false,
    error_code: "provider_unreachable",
  });
});

void test("an allowlisted host redirecting at the metadata address is refused, and the target never sent", async () => {
  const calls: string[] = [];
  const redirecting: typeof globalThis.fetch = (input) => {
    calls.push(new Request(input).url);
    const headers = { location: "https://169.254.169.254/v1" };
    return Promise.resolve(new Response(null, { status: 302, headers }));
  };
  const verdict = await probeAgainst(redirecting);
  assert.equal(verdict.error_code, "provider_unreachable");
  assert.deepEqual(calls.map((url) => new URL(url).host), ["api.openai.com"]);
});

// ── the third containment: how much the probe will read ───────────────────

void test("a body past the cap is errored rather than truncated into a shorter answer", async () => {
  const oversized = new Response("x".repeat(PROBE_RESPONSE_CAP_BYTES + 1));
  await assert.rejects(() => cappedResponse(oversized).text());
});

void test("a body within the cap passes through byte for byte", async () => {
  assert.equal(await cappedResponse(new Response("ok")).text(), "ok");
});

/** The WIRING, measured at the source: a provider that keeps talking is cut
 * off, so the bytes it hands over stay bounded instead of reaching whatever it
 * wanted to send. The bound is the cap plus the transform's own read-ahead
 * queue — a stream cannot stop mid-chunk — not the cap exactly. */
void test("the probe stops pulling from a flooding provider once the cap is crossed", async () => {
  const chunk = 16 * 1024;
  const wanted = chunk * 64;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= wanted) {
        controller.close();
        return;
      }
      sent += chunk;
      controller.enqueue(new Uint8Array(chunk));
    },
  });
  const headers = { "content-type": "text/event-stream" };
  await probeAgainst(() => Promise.resolve(new Response(body, { status: 200, headers })));
  assert.ok(sent < wanted, "the provider must not have delivered everything it had");
  assert.ok(sent <= PROBE_RESPONSE_CAP_BYTES * 2, `read ${String(sent)} bytes for a 64 KiB cap`);
});

// ── the whole point of the image part ──────────────────────────────────────

void test("a model that answers the image-bearing probe is reported as vision-capable", async () => {
  assert.deepEqual(await probeAgainst(answeringUpstream()), {
    vision: true,
    reachable: true,
    error_code: null,
  });
});
