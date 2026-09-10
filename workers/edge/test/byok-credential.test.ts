import test from "node:test";
import assert from "node:assert/strict";
import { ByokRejection } from "../src/agent/byok/byok-credential.ts";
import { byokCredentialIn, byokSignalIn } from "../src/agent/byok/byok-headers.ts";

// W2-3 (#1289) — the four `X-BYOK-*` headers, parsed. The semantics are
// ported from `apps/agent/src/animichi/agents/byok_models.py`
// (`parse_byok_credential` / `has_byok_signal`); the base-URL half is
// delegated to `EgressPolicy`, so S5's red lines are enforced by the SAME
// module the spike measured rather than by a second copy of them here.

/** A zero-entropy fixture: never a real key, and short enough to be obvious. */
const FIXTURE_KEY = "byok-test-key-0000";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

/** The refusal a header set earns. `assert.throws` answers `undefined`, and
 * every case below is about the SHAPE of the rejection, not merely that one
 * happened. */
function rejectionOf(values: Record<string, string>): ByokRejection {
  try {
    byokCredentialIn(headers(values));
  } catch (error) {
    assert.ok(error instanceof ByokRejection);
    return error;
  }
  throw new assert.AssertionError({ message: "the header set was accepted" });
}

// ── no signal at all ────────────────────────────────────────────────────────

void test("a request with no BYOK headers carries no credential and no signal", () => {
  const request = headers({ "content-type": "application/json" });
  assert.equal(byokCredentialIn(request), null);
  assert.equal(byokSignalIn(request), false);
});

void test("a provider header alone is a BYOK signal, so a malformed set is not silently ignored", () => {
  assert.equal(byokSignalIn(headers({ "X-BYOK-Provider": "anthropic" })), true);
  assert.equal(byokSignalIn(headers({ "X-BYOK-Key": FIXTURE_KEY })), true);
});

// ── every malformed header set is the SAME refusal ─────────────────────────

const MALFORMED: [string, Record<string, string>][] = [
  ["an orphaned model header with neither provider nor key", { "X-BYOK-Model": "gpt-4o-mini" }],
  ["an orphaned base-url header", { "X-BYOK-Base-Url": "https://api.openai.com/v1" }],
  ["an unknown provider", { "X-BYOK-Provider": "openai", "X-BYOK-Key": FIXTURE_KEY }],
  ["a missing key", { "X-BYOK-Provider": "anthropic" }],
  ["a blank key", { "X-BYOK-Provider": "anthropic", "X-BYOK-Key": "   " }],
  ["a missing provider", { "X-BYOK-Key": FIXTURE_KEY }],
  [
    "an openai-compatible credential with no base url",
    { "X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": FIXTURE_KEY, "X-BYOK-Model": "gpt-4o-mini" },
  ],
  [
    "an openai-compatible credential with no model",
    {
      "X-BYOK-Provider": "openai-compatible",
      "X-BYOK-Key": FIXTURE_KEY,
      "X-BYOK-Base-Url": "https://api.openai.com/v1",
    },
  ],
  [
    "an anthropic credential carrying a base url it may not choose",
    {
      "X-BYOK-Provider": "anthropic",
      "X-BYOK-Key": FIXTURE_KEY,
      "X-BYOK-Base-Url": "https://api.anthropic.com",
    },
  ],
  [
    "a gemini credential carrying a base url it may not choose",
    { "X-BYOK-Provider": "gemini", "X-BYOK-Key": FIXTURE_KEY, "X-BYOK-Base-Url": "https://evil.test" },
  ],
];

for (const [label, values] of MALFORMED) {
  void test(`${label} is refused as invalid_request`, () => {
    const rejection = rejectionOf(values);
    assert.equal(rejection.code, "invalid_request");
    assert.equal(rejection.reason, null);
  });
}

// ── the base URL is decided by EgressPolicy, not by a second rule set ──────

const REFUSED_BASE_URLS: [string, string][] = [
  ["a private address", "https://10.0.0.5/v1"],
  ["the cloud metadata address", "https://169.254.169.254/v1"],
  ["a link-local IPv6 literal", "https://[fe80::1]/v1"],
  ["a loopback address", "https://127.0.0.1/v1"],
  ["a non-443 port", "https://api.openai.com:8080/v1"],
  ["a plaintext scheme", "http://api.openai.com/v1"],
  ["our own infrastructure", "https://edge.animichi.com/v1"],
  ["a host that is not on the allowlist", "https://api.openai.com.evil.test/v1"],
];

for (const [label, baseUrl] of REFUSED_BASE_URLS) {
  void test(`${label} is refused by the egress policy, with the reason kept for the log`, () => {
    const values = {
      "X-BYOK-Provider": "openai-compatible",
      "X-BYOK-Key": FIXTURE_KEY,
      "X-BYOK-Model": "gpt-4o-mini",
      "X-BYOK-Base-Url": baseUrl,
    };
    const rejection = rejectionOf(values);
    assert.equal(rejection.code, "egress_blocked");
    assert.notEqual(rejection.reason, null);
  });
}

// ── the three families, accepted ───────────────────────────────────────────

void test("an openai-compatible credential keeps the caller's allowlisted base url and model", () => {
  const credential = byokCredentialIn(headers({
    "X-BYOK-Provider": "openai-compatible",
    "X-BYOK-Key": FIXTURE_KEY,
    "X-BYOK-Model": "gpt-4o-mini",
    "X-BYOK-Base-Url": "https://api.openai.com/v1",
  }));
  assert.ok(credential !== null);
  assert.equal(credential.family, "openai-compatible");
  assert.equal(credential.provider, "openai");
  assert.equal(credential.modelId, "gpt-4o-mini");
  assert.equal(credential.baseUrl, "https://api.openai.com/v1");
});

void test("an anthropic credential without a model falls back to the named default", () => {
  const credential = byokCredentialIn(headers({
    "X-BYOK-Provider": "anthropic",
    "X-BYOK-Key": FIXTURE_KEY,
  }));
  assert.ok(credential !== null);
  assert.equal(credential.modelId, "claude-sonnet-4-5");
  assert.equal(credential.baseUrl, "https://api.anthropic.com");
  assert.equal(credential.provider, "anthropic");
});

void test("a gemini credential is driven through Google's OpenAI-compatible surface (Appendix D)", () => {
  const credential = byokCredentialIn(headers({
    "X-BYOK-Provider": "gemini",
    "X-BYOK-Key": FIXTURE_KEY,
    "X-BYOK-Model": "gemini-2.5-flash",
  }));
  assert.ok(credential !== null);
  assert.equal(credential.provider, "google");
  assert.equal(credential.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai/");
});

void test("validated RPC input has no custom credential carrier and native Models own its transient key", async () => {
  const { nativeByokModels } = await import("../src/agent/host/native-models.ts");
  const credential = byokCredentialIn(headers({ "X-BYOK-Provider": "anthropic", "X-BYOK-Key": FIXTURE_KEY }));
  assert.ok(credential);
  assert.equal(Object.getPrototypeOf(credential), Object.prototype);
  const native = await nativeByokModels(credential, () => Promise.reject(new Error("No probe is needed")));
  assert.equal((await native.models.getAuth(native.model.provider))?.auth.apiKey, FIXTURE_KEY);
  assert.doesNotMatch(JSON.stringify(native.model), new RegExp(FIXTURE_KEY));
  await native.models.logout(native.model.provider);
  assert.equal(await native.models.getAuth(native.model.provider), undefined);
});
