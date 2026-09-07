import test from "node:test";
import assert from "node:assert/strict";
import { REDACTED, SecretScrub } from "../src/agent/egress/secret-scrub.ts";

// W0-S5 (#1248): the last red line — a key must not survive into a log line,
// a span attribute or an error body. Every shape below is one the three BYOK
// provider families actually issue, plus the raw literal for the shapes none
// of the patterns can know about.
//
// The prefixes are real — they are the whole of what `SecretScrub` matches on
// — but the bodies are a repeating `0Aa` cycle on purpose (#1435). gitleaks'
// default rules gate on Shannon entropy once a shape matches: measured on
// 8.24.3, the version CI pins, `generic-api-key` fires above 3.5 and
// `gcp-api-key` above 3, and a body that looks issued clears both. A git-range
// scan reads only added lines, so an unrelated edit here stays clean — what
// fires is any commit that re-adds one of these lines, a trap for whoever next
// moves them. The cycle scores under 2.9 and keeps the length each provider
// issues; it is a digit, an upper- and a lower-case letter, not everything
// `[A-Za-z0-9_-]` admits, because each extra distinct character costs margin
// and margin is the point. `OPAQUE_KEY` stays 32 hex characters, matching
// nothing by shape, which is its whole job.
//
// The alternatives are suppressions: `gitleaks:allow` and a `.gitleaksignore`
// fingerprint hide the line, an allowlist path hides the file, all three need
// owner approval under AGENTS.md, and none of them makes the line honest.
//
// `ANTHROPIC_KEY` is allowlisted whatever its entropy: `generic-api-key`'s
// stopword list carries `ant-`, which `sk-ant-api03-` contains — the same body
// fires behind `sk-xyz-api03-`. That is an accident of the default ruleset any
// gitleaks bump can take away, so it gets the same body as its siblings rather
// than an exemption.
//
// Do not "fix" any of them back into something that looks issued.
//
// test-type: unit (pure string work, no network, no clock).

const OPENAI_KEY = "sk-proj-0Aa0Aa0Aa0Aa0Aa0Aa0Aa0Aa";
const ANTHROPIC_KEY = "sk-ant-api03-0Aa0Aa0Aa0Aa0Aa0Aa";
const GOOGLE_KEY = "AIza0Aa0Aa0Aa0Aa0Aa0Aa0Aa0Aa0Aa0Aa0Aa0A";
const OPAQUE_KEY = "0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a";

const shapes = new SecretScrub();

/** label, the text a provider might emit, and exactly what it must become. */
const SHAPE_ROWS: readonly [string, string, string][] = [
  ["an OpenAI key", `Incorrect API key provided: ${OPENAI_KEY}`, `Incorrect API key provided: ${REDACTED}`],
  ["an Anthropic key", `invalid x-api-key ${ANTHROPIC_KEY}`, `invalid x-api-key ${REDACTED}`],
  ["a Google key", `API key not valid: ${GOOGLE_KEY}`, `API key not valid: ${REDACTED}`],
  // The `sk-` pattern runs before the `Bearer` one and eats the value first;
  // the key is gone either way, so the next row is what pins `Bearer` itself.
  ["a Bearer-wrapped OpenAI key", `authorization: Bearer ${OPENAI_KEY}`, `authorization: Bearer ${REDACTED}`],
  ["an opaque bearer token", `authorization: Bearer ${OPAQUE_KEY}`, `authorization: ${REDACTED}`],
];

for (const [label, text, expected] of SHAPE_ROWS) {
  void test(`${label} is redacted by shape alone`, () => {
    assert.equal(shapes.text(text), expected);
  });
}

void test("a key with no recognisable shape is redacted by its literal value", () => {
  const opaque = new SecretScrub([OPAQUE_KEY]);
  assert.equal(shapes.text(`rejected token ${OPAQUE_KEY}`).includes(OPAQUE_KEY), true);
  assert.equal(opaque.text(`rejected token ${OPAQUE_KEY}`).includes(OPAQUE_KEY), false);
});

void test("the literal is matched everywhere it appears, not just the first time", () => {
  const scrub = new SecretScrub([OPAQUE_KEY]);
  const scrubbed = scrub.text(`${OPAQUE_KEY} and again ${OPAQUE_KEY}`);
  assert.equal(scrubbed, `${REDACTED} and again ${REDACTED}`);
});

void test("no key is too short to redact, and a blank one is not a pattern", () => {
  assert.equal(new SecretScrub(["ab"]).text("a fabulous absolute"), `a f${REDACTED}ulous ${REDACTED}solute`);
  assert.equal(new SecretScrub(["", "   "]).text("nothing to hide"), "nothing to hide");
});

void test("a literal carrying regex metacharacters is escaped, not compiled", () => {
  const scrub = new SecretScrub(["key.+with(specials)"]);
  assert.equal(scrub.text("kexxxwith"), "kexxxwith");
  assert.equal(scrub.text("saw key.+with(specials) here"), `saw ${REDACTED} here`);
});

void test("diagnostic text around the key is preserved", () => {
  const scrubbed = shapes.text(`401 Unauthorized from api.openai.com: ${OPENAI_KEY} is revoked`);
  assert.equal(scrubbed, `401 Unauthorized from api.openai.com: ${REDACTED} is revoked`);
});

void test("a log payload is scrubbed all the way down", () => {
  const scrub = new SecretScrub([OPAQUE_KEY]);
  const scrubbed = scrub.payload({
    provider: "openai",
    attempts: [{ header: `Bearer ${OPENAI_KEY}` }, { token: OPAQUE_KEY }],
    status: 401,
    retried: false,
    cause: null,
  });
  assert.equal(JSON.stringify(scrubbed).includes(OPENAI_KEY), false);
  assert.equal(JSON.stringify(scrubbed).includes(OPAQUE_KEY), false);
});

void test("a log payload keeps its shape and its non-string values", () => {
  const scrubbed = shapes.payload({ status: 401, retried: false, cause: null, tags: ["byok"] });
  assert.deepEqual(scrubbed, { status: 401, retried: false, cause: null, tags: ["byok"] });
});

void test("an Error's name and message are scrubbed together", () => {
  const scrub = new SecretScrub([OPAQUE_KEY]);
  const text = scrub.errorText(new TypeError(`fetch failed for ${OPAQUE_KEY}`));
  assert.equal(text, `TypeError: fetch failed for ${REDACTED}`);
});

void test("a thrown non-Error is still turned into scrubbed text", () => {
  assert.equal(shapes.errorText(`raw ${GOOGLE_KEY}`), `raw ${REDACTED}`);
  assert.equal(shapes.errorText({ nested: "object" }), "unknown error");
});
