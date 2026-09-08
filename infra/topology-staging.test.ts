/** Staging topology with both flags ON.
 *
 * Separate file because `index.ts` builds at import time and a process can
 * load it once — see `testing/harness.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as pulumi from "@pulumi/pulumi";
import { buildStack, only, ofType, unseal, type Built } from "./testing/harness.ts";

const built: Built[] = await buildStack("staging", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  stagingDomain: "staging.animichi.com",
  stagingGateEnabled: "true",
  stagingGateToken: "test-token-not-a-real-secret",
  stagingAllowedIps: "1.2.3.4, 203.0.113.0/24",
});

const CUSTOM_DOMAIN = "cloudflare:index/workersCustomDomain:WorkersCustomDomain";
const ROUTE = "cloudflare:index/workersRoute:WorkersRoute";
const DNS = "cloudflare:index/dnsRecord:DnsRecord";
const RULESET = "cloudflare:index/ruleset:Ruleset";
const ZONE_DNSSEC = "cloudflare:index/zoneDnssec:ZoneDnssec";
const ZONE_SETTING = "cloudflare:index/zoneSetting:ZoneSetting";
const SERVICE_TOKEN = "cloudflare:index/zeroTrustAccessServiceToken:ZeroTrustAccessServiceToken";

test("staging targets the stack-suffixed Workers, not the production ones", () => {
  const domain = only(built, CUSTOM_DOMAIN);
  assert.equal(domain.inputs.hostname, "staging.animichi.com");
  assert.equal(domain.inputs.service, "animichi-web-staging");
});

test("staging gets the SAME API and map routes as prod", () => {
  // The bug this exists to prevent: a staging hostname pointed wholly at the
  // web Worker. `apps/web` calls `/v1/chat` on its own origin, so that
  // configuration leaves staging with no chat API at all — and nothing else
  // in the pipeline would notice.
  const patterns = ofType(built, ROUTE).map((r) => r.inputs.pattern).sort();
  assert.deepEqual(patterns, [
    "staging.animichi.com/healthz",
    "staging.animichi.com/img/*",
    "staging.animichi.com/tiles/*",
    "staging.animichi.com/v1/*",
  ]);
  for (const route of ofType(built, ROUTE)) {
    assert.equal(route.inputs.zoneId, "zone", "a route on the wrong zone matches nothing");
    assert.equal(route.inputs.script, "animichi-staging");
  }
});

test("no www placeholder and no redirect on staging", () => {
  assert.deepEqual(ofType(built, DNS).filter((r) => r.inputs.name === "www.animichi.com"), []);
  const rulesets = ofType(built, RULESET).map((r) => r.name).sort();
  assert.deepEqual(rulesets, ["staging-access-gate", "staging-http-config-settings"]);
});

test("staging declares no CAA records — prod owns the zone certificates", () => {
  // PR #776: zone hardening is prod-only. A staging CAA record would pin a
  // hostname on the same zone the prod stack manages.
  assert.deepEqual(ofType(built, DNS).filter((r) => r.inputs.type === "CAA"), []);
});

test("the WAF gate blocks, and matches the staging host", () => {
  const gate = ofType(built, RULESET).find((r) => r.name === "staging-access-gate");
  assert.ok(gate, "staging access gate missing");
  const rules = unseal(gate.inputs.rules).value as Record<string, unknown>[];
  assert.equal(rules[0].action, "block");
  const expression = String(rules[0].expression);
  assert.match(expression, /http\.host eq "staging\.animichi\.com"/);
  assert.match(expression, /not \(http\.cookie contains "animichi_staging=/);
  assert.match(expression, /not \(any\(http\.request\.headers\["x-staging-key"\]/);
  // #769: the allowlist clause is space-separated inside the braces, and the
  // exchange path passes through ahead of any future endpoint existing.
  assert.match(expression, /not \(ip\.src in \{1\.2\.3\.4 203\.0\.113\.0\/24\}\)/);
  assert.match(expression, /not \(http\.request\.uri\.path eq "\/staging-gate\/exchange"\)/);
});

test("staging builds exactly one http_config_settings ruleset with bic=false", () => {
  const settings = ofType(built, RULESET).filter((r) => r.inputs.phase === "http_config_settings");
  assert.equal(settings.length, 1);
  const rule = (unseal(settings[0].inputs.rules).value as Record<string, unknown>[])[0];
  assert.equal(rule.action, "set_config");
  assert.equal(String(rule.expression), 'http.host eq "staging.animichi.com"');
  const params = rule.actionParameters as Record<string, unknown>;
  assert.equal(params.bic, false);
  assert.equal(params.securityLevel, "essentially_off");
  assert.equal(settings[0].inputs.zoneId, "zone");
});

test("the gate rule is sealed as a SECRET before it reaches state", () => {
  // The load-bearing one for a public repo. Anything not marked secret is
  // written into Pulumi Cloud state in the clear, and comes back out in the
  // clear in any operator `pulumi stack export`. Note the seal propagated to
  // the WHOLE rules array, not just the expression string, so the token cannot
  // leak via a sibling field.
  //
  // Mutation-tested, and the result is worth recording because it is not the
  // obvious one: dropping `pulumi.secret(...)` alone does NOT fail this, and
  // downgrading `requireSecret` to `require` alone does NOT either. Each is
  // sufficient on its own — secretness is viral through `pulumi.interpolate`,
  // and `pulumi.secret` forces it regardless of the input. Only removing BOTH
  // fails this test. That is the correct sensitivity for a defence-in-depth
  // invariant: it asserts the property (sealed), not either mechanism, so
  // refactoring one away stays green while actually losing the seal goes red.
  const gate = ofType(built, RULESET).find((r) => r.name === "staging-access-gate");
  assert.ok(gate, "staging access gate missing");
  assert.equal(unseal(gate.inputs.rules).isSecret, true);
});

test("staging owns none of the zone-hardening resources", () => {
  // PR #776: prod is the single owner of zone metadata. Two stacks declaring
  // the same zone resources (DNSSEC, security header, rate-limit ruleset)
  // would fight over them on `pulumi up`, so staging must expect NONE of them
  // even with zoneId and routes configured.
  assert.deepEqual(ofType(built, ZONE_DNSSEC), []);
  assert.deepEqual(ofType(built, ZONE_SETTING), []);
  const rateLimit = ofType(built, RULESET).find((r) => r.name === "animichi-api-rate-limit");
  assert.equal(rateLimit, undefined, "staging must not declare the rate-limit ruleset");
});

test("an ordinary input on this same stack is NOT sealed", () => {
  // Control for the test above. If `unseal` reported everything as secret —
  // a wrong sentinel, a changed wire format — that assertion would pass no
  // matter what the code did. A route pattern is the nearest non-secret input.
  //
  // Named for what it does. The first version called itself "the www redirect
  // on prod is NOT secret", which was wrong twice over: this file builds
  // staging, and the assertion is on a route pattern, not the redirect.
  const routes = ofType(built, ROUTE);
  assert.ok(routes.length > 0);
  assert.equal(unseal(routes[0].inputs.pattern).isSecret, false);
});

test("staging buckets are isolated from production and stay private", () => {
  const buckets = ofType(built, "cloudflare:index/r2Bucket:R2Bucket");
  assert.equal(buckets.length, 3);
  assert.deepEqual(buckets.map((bucket) => bucket.inputs.name), [
    "catalog-media-staging",
    "map-tiles-staging",
    "catalog-snapshots-staging",
  ]);
  assert.equal(buckets.every((bucket) => bucket.inputs.accountId === "acct"), true);
  const customDomains = ofType(built, "cloudflare:index/r2CustomDomain:R2CustomDomain");
  assert.deepEqual(customDomains, []);
});

test("staging mints the one Access service token CI presents at the front door", () => {
  // D3 #1369 PR 1. The Cloudflare-side `name` is what an operator matches in the
  // Zero Trust dashboard when revoking, and the resource name is what Pulumi
  // matches in state — renaming either is a delete-and-recreate that silently
  // invalidates every caller's headers, so both are pinned.
  const token = only(built, SERVICE_TOKEN);
  assert.equal(token.name, "staging-ci");
  assert.equal(token.inputs.name, "animichi-staging-ci");
  assert.equal(token.inputs.accountId, "acct");
  assert.equal(token.inputs.duration, "8760h");
});

test("the token's two halves are exported under the names ESC imports", async () => {
  // Pulumi ESC's `pulumi-stacks` provider reads stack outputs BY NAME, and a
  // name it cannot resolve imports as empty rather than failing. So a rename
  // here would leave `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` blank in
  // `lifeodyssey/animichi/staging` and every automated caller locked out with no
  // red anywhere. These two names are the wiring contract.
  const program = (await import("./index.ts")) as Record<string, unknown>;
  assert.ok(program.stagingAccessClientId, "ESC imports stagingAccessClientId");
  assert.ok(program.stagingAccessClientSecret, "ESC imports stagingAccessClientSecret");
});

test("the client secret is sealed before it reaches state, and the id is not", async () => {
  // Same invariant, and same reason, as the WAF gate expression above: this
  // repository is public and an unsealed value comes back in the clear from any
  // operator `pulumi stack export`. The id is the control — if `isSecret`
  // reported everything sealed, the first assertion would pass on any code.
  const program = (await import("./index.ts")) as Record<string, unknown>;
  const secret = program.stagingAccessClientSecret as pulumi.Output<string>;
  const id = program.stagingAccessClientId as pulumi.Output<string>;
  assert.equal(await pulumi.isSecret(secret), true);
  assert.equal(await pulumi.isSecret(id), false);
});
