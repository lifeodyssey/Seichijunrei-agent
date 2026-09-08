/** Staging topology: hostnames, routes, buckets and the zone resources it must
 * NOT own. The Cloudflare Access door on the same stack is
 * `topology-staging-access.test.ts`.
 *
 * Separate file because `index.ts` builds at import time and a process can
 * load it once — see `testing/harness.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack, only, ofType, unseal, type Built } from "./testing/harness.ts";

const built: Built[] = await buildStack("staging", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  stagingDomain: "staging.animichi.com",
  // Object config reaches the program as the JSON blob Pulumi stores it as.
  stagingAccessAllowedEmails: '["owner@example.test", "second@example.test"]',
});

const CUSTOM_DOMAIN = "cloudflare:index/workersCustomDomain:WorkersCustomDomain";
const ROUTE = "cloudflare:index/workersRoute:WorkersRoute";
const DNS = "cloudflare:index/dnsRecord:DnsRecord";
const RULESET = "cloudflare:index/ruleset:Ruleset";
const ZONE_DNSSEC = "cloudflare:index/zoneDnssec:ZoneDnssec";
const ZONE_SETTING = "cloudflare:index/zoneSetting:ZoneSetting";

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
  // One ruleset, and only one: D3 (#1369) deleted the `staging-access-gate` WAF
  // rule this file used to pin. A regrown blocking rule beside Cloudflare Access
  // is two doors with one key between them.
  assert.deepEqual(rulesets, ["staging-http-config-settings"]);
});

test("staging declares no CAA records — prod owns the zone certificates", () => {
  // PR #776: zone hardening is prod-only. A staging CAA record would pin a
  // hostname on the same zone the prod stack manages.
  assert.deepEqual(ofType(built, DNS).filter((r) => r.inputs.type === "CAA"), []);
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
  // The control for every `isSecret` assertion in this package, which is why it
  // outlived the WAF-gate test it was written beside (D3 #1369). If `unseal`
  // reported everything as secret — a wrong sentinel, a changed wire format —
  // those assertions would pass no matter what the code did. A route pattern is
  // the nearest non-secret input.
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
