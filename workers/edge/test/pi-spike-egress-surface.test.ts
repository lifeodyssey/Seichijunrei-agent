import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EGRESS_PROMPT,
  parseEgressProbeCommand,
  type EgressProbeCommand,
} from "../spike/pi/src/egress-probe-command.ts";
import { EgressProbe } from "../spike/pi/src/egress-probe.ts";
import { PLATFORM_PROBE_TARGETS, probePlatformEgress } from "../spike/pi/src/platform-egress-probe.ts";
import { probeRedirectFixture } from "../spike/pi/src/redirect-fixture-probe.ts";
import { routeOf } from "../spike/pi/src/spike-routes.ts";
import { RedirectToFixture } from "./doubles/redirect-to-fixture.ts";
import { ScriptedEgressFetch } from "./doubles/scripted-egress-fetch.ts";

// W0-S5 (#1248): the probe Worker's S5 surface — the two new routes, the
// request vocabulary, and the report `POST /egress` answers with. The real
// provider round trip is driven here over a scripted fetch double; the deployed
// run is scripts/spike/pi-s5-egress.sh.
//
// test-type: unit (scripted fetch double, no network, no clock, no bindings).

// A repeating body, for the reason `byok-secret-scrub.test.ts` spells out:
// `sk-proj-` is the half `SecretScrub` matches on, and a body that looks issued
// clears gitleaks' entropy floor, which makes any commit that re-adds this line
// a finding (#1435). Do not "fix" it back.
const KEY = "sk-proj-0Aa0Aa0Aa0Aa0Aa0Aa0Aa0Aa";

void test("S5 adds two routes and leaves the earlier ones alone", () => {
  assert.equal(routeOf("POST", "/egress"), "egress");
  assert.equal(routeOf("GET", "/egress/platform"), "egress_platform");
  assert.equal(routeOf("GET", "/healthz"), "healthz");
  assert.equal(routeOf("POST", "/turn/long"), "turn_long");
});

void test("the S5 routes answer only their own method", () => {
  assert.equal(routeOf("GET", "/egress"), "not_found");
  assert.equal(routeOf("POST", "/egress/platform"), "not_found");
  assert.equal(routeOf("DELETE", "/egress"), "not_found");
});

function commandOf(body: unknown): EgressProbeCommand {
  const parsed = parseEgressProbeCommand(body);
  assert.ok(parsed.ok, "expected the body to parse");
  return parsed.command;
}

void test("a probe command needs a base URL and nothing else", () => {
  assert.deepEqual(commandOf({ baseUrl: "https://api.openai.com/v1" }), {
    provider: "",
    baseUrl: "https://api.openai.com/v1",
    key: "",
    prompt: DEFAULT_EGRESS_PROMPT,
  });
});

void test("the parser hands an unknown provider through for the policy to refuse", () => {
  const body = { provider: "openrouter", baseUrl: "https://x.test/" };
  assert.equal(commandOf(body).provider, "openrouter");
});

void test("a body that is not a JSON object, or has no base URL, is rejected", () => {
  assert.equal(parseEgressProbeCommand("openai").ok, false);
  assert.equal(parseEgressProbeCommand(null).ok, false);
  assert.equal(parseEgressProbeCommand({ provider: "openai" }).ok, false);
});

void test("a refused destination is reported without contacting anything", async () => {
  const inner = new ScriptedEgressFetch([{ status: 200 }]);
  const report = await new EgressProbe(undefined, inner.fetch).run({
    provider: "openai",
    baseUrl: "https://169.254.169.254/v1",
    key: KEY,
    prompt: "ping",
  });
  assert.deepEqual(
    { decision: report.decision, reason: report.reason, roundTrip: report.roundTrip },
    { decision: "deny", reason: "metadata_address", roundTrip: "skipped" },
  );
  assert.deepEqual(inner.calls, []);
});

void test("an empty key is refused before a provider client could fall back to a server key", async () => {
  const inner = new ScriptedEgressFetch([{ status: 200 }]);
  const report = await new EgressProbe(undefined, inner.fetch).run({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    key: "",
    prompt: "ping",
  });
  assert.equal(report.reason, "empty_key");
  assert.deepEqual(inner.calls, []);
});

const PROVIDER_ERROR = JSON.stringify({
  error: { message: `Incorrect API key provided: ${KEY}`, type: "invalid_request_error" },
});

void test("an allowed destination runs the real pi round trip through the guard", async () => {
  const inner = new ScriptedEgressFetch([{ status: 401, body: PROVIDER_ERROR }]);
  const report = await new EgressProbe(undefined, inner.fetch).run({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    key: KEY,
    prompt: "ping",
  });
  assert.equal(report.decision, "allow");
  assert.equal(report.roundTrip, "failed");
  assert.equal(inner.calls[0]?.url, "https://api.openai.com/v1/chat/completions");
});

void test("a provider error echoing the key never reaches the report unredacted", async () => {
  const inner = new ScriptedEgressFetch([{ status: 401, body: PROVIDER_ERROR }]);
  const report = await new EgressProbe(undefined, inner.fetch).run({
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    key: KEY,
    prompt: "ping",
  });
  assert.equal(report.providerEchoedKey, true, "the double's body carries the key on purpose");
  assert.equal(report.keyLeaked, false);
  assert.equal(report.detail.includes(KEY), false);
});

void test("the platform probe targets are fixed, so no caller can steer it", async () => {
  const inner = new ScriptedEgressFetch([{ status: 200 }]);
  const rows = await probePlatformEgress(inner.fetch);
  assert.deepEqual(rows.map((row) => row.target), [...PLATFORM_PROBE_TARGETS]);
  assert.deepEqual(rows.map((row) => row.outcome), rows.map(() => "reachable"));
});

void test("a runtime refusal is reported as blocked, with the runtime's own words", async () => {
  const refusing = (): Promise<Response> =>
    Promise.reject(new TypeError("Fetch API cannot load: internal address"));
  const rows = await probePlatformEgress(refusing);
  assert.deepEqual(rows.map((row) => row.outcome), rows.map(() => "blocked"));
  assert.equal(rows[0]?.detail, "TypeError: Fetch API cannot load: internal address");
});

void test("a redirect pointing inside is refused by the range it points at", async () => {
  const rows = await probeRedirectFixture(new RedirectToFixture().fetch);
  assert.deepEqual(
    rows.map((row) => [row.name, row.outcome]),
    [
      ["redirect-to-metadata", "metadata_address"],
      ["redirect-off-allowlist", "host_not_allowlisted"],
      ["redirect-to-plaintext", "scheme_not_https"],
      ["redirect-followed", "followed"],
    ],
  );
});

void test("the control row proves the guard does follow a re-validated redirect", async () => {
  const fixture = new RedirectToFixture();
  const rows = await probeRedirectFixture(fixture.fetch);
  assert.deepEqual(rows.map((row) => row.hops), [1, 1, 1, 1]);
  assert.deepEqual(rows.map((row) => row.status), [null, null, null, 418]);
  assert.deepEqual(fixture.requested, [
    "https://httpbingo.org/redirect-to?url=%2Fstatus%2F418",
    "https://httpbingo.org/status/418",
  ]);
});
