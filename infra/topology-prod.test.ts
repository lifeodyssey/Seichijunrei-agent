/** Prod topology with the cutover flag ON.
 *
 * These assert the things `tsc` cannot: which script each hostname resolves
 * to, the exact route patterns, the redirect's direction, and that the www
 * placeholder is proxied. Every one of them is a mistake that type-checks
 * cleanly and only surfaces once DNS is live.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack, only, ofType, unseal, type Built } from "./testing/harness.ts";

const built: Built[] = await buildStack("prod", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  webDomain: "animichi.com",
  wwwDomain: "www.animichi.com",
});

const CUSTOM_DOMAIN = "cloudflare:index/workersCustomDomain:WorkersCustomDomain";
const ROUTE = "cloudflare:index/workersRoute:WorkersRoute";
const DNS = "cloudflare:index/dnsRecord:DnsRecord";
const RULESET = "cloudflare:index/ruleset:Ruleset";
const ZONE_DNSSEC = "cloudflare:index/zoneDnssec:ZoneDnssec";
const SERVICE_TOKEN = "cloudflare:index/zeroTrustAccessServiceToken:ZeroTrustAccessServiceToken";
const ZONE_SETTING = "cloudflare:index/zoneSetting:ZoneSetting";

test("the apex serves the web Worker, not the edge Worker", () => {
  const domain = only(built, CUSTOM_DOMAIN);
  assert.equal(domain.inputs.hostname, "animichi.com");
  assert.equal(domain.inputs.service, "animichi-web");
});

test("the API and map asset surfaces are routed to the edge Worker", () => {
  const patterns = ofType(built, ROUTE).map((r) => r.inputs.pattern).sort();
  assert.deepEqual(patterns, [
    "animichi.com/healthz",
    "animichi.com/img/*",
    "animichi.com/tiles/*",
    "animichi.com/v1/*",
  ]);
  for (const route of ofType(built, ROUTE)) {
    assert.equal(route.inputs.zoneId, "zone", "a route on the wrong zone matches nothing");
    assert.equal(route.inputs.script, "animichi", `${String(route.inputs.pattern)} script`);
  }
});

test("the apex DNS records are exactly the four CAA issuers", () => {
  // The Custom Domain owns the apex hostname record itself (Cloudflare creates
  // it and marks it read-only); declaring any other apex record would fight it.
  // CAA is the deliberate exception: it is the one record class that must live
  // beside the hostname it constrains.
  const apex = ofType(built, DNS).filter((r) => r.inputs.name === "animichi.com");
  assert.equal(apex.length, 4);
  assert.equal(apex.every((r) => r.inputs.type === "CAA"), true);
  assert.equal(apex.every((r) => r.inputs.zoneId === "zone"), true);
  assert.equal(apex.every((r) => (r.inputs.data as { tag: string }).tag === "issue"), true);
  const issuers = apex
    .map((r) => (r.inputs.data as { value: string }).value)
    .sort();
  assert.deepEqual(issuers, [
    "digicert.com; cansignhttpexchanges=yes",
    "letsencrypt.org",
    "pki.goog; cansignhttpexchanges=yes",
    "ssl.com",
  ]);
});

test("the www placeholder is the reserved originless address AND proxied", () => {
  const record = ofType(built, DNS).find((r) => r.inputs.name === "www.animichi.com");
  assert.ok(record, "www placeholder record missing");
  assert.equal(record.inputs.content, "192.0.2.0");
  // Unproxied, the request goes to a reserved address that answers nothing and
  // the redirect rule never runs. This is the assertion that catches that.
  assert.equal(record.inputs.proxied, true);
});

test("the redirect points www AT the apex, not the other way round", () => {
  const redirect = ofType(built, RULESET).find((r) => r.name === "animichi-www-redirect");
  assert.ok(redirect, "www redirect ruleset missing");
  const rules = unseal(redirect.inputs.rules).value as Record<string, unknown>[];
  const rule = rules[0];
  assert.equal(
    String(rule.expression),
    'http.host eq "www.animichi.com"',
    "must match www — matching the apex would redirect the site to itself",
  );
  const params = rule.actionParameters as { fromValue: Record<string, unknown> };
  const target = params.fromValue.targetUrl as { expression: string };
  assert.match(target.expression, /"https:\/\/animichi\.com"/);
  assert.doesNotMatch(target.expression, /www/, "target must be the apex, not www");
  assert.equal(params.fromValue.statusCode, 301);
});

test("the staging WAF gate stays off on prod", () => {
  // Its own flag is unset here, but the `stack === "staging"` guard is the
  // structural one: a Block rule on the production zone is the worst thing
  // this file could emit.
  const rulesets = ofType(built, RULESET).map((r) => r.name).sort();
  assert.deepEqual(rulesets, ["animichi-api-rate-limit", "animichi-www-redirect"]);
  for (const ruleset of ofType(built, RULESET)) {
    const rules = unseal(ruleset.inputs.rules).value as { action: string }[];
    assert.notEqual(rules[0].action, "block", `${ruleset.name} must not block`);
  }
});

test("DNSSEC is enabled on the zone", () => {
  assert.equal(only(built, ZONE_DNSSEC).inputs.zoneId, "zone");
});

test("the API rate limit dampens /v1 bursts across the zone", () => {
  const ruleset = ofType(built, RULESET).find((r) => r.name === "animichi-api-rate-limit");
  assert.ok(ruleset, "rate limit ruleset missing");
  assert.equal(ruleset.inputs.phase, "http_ratelimit");
  const rule = (unseal(ruleset.inputs.rules).value as Record<string, unknown>[])[0];
  assert.equal(rule.action, "managed_challenge");
  const ratelimit = rule.ratelimit as Record<string, unknown>;
  assert.deepEqual(ratelimit.characteristics, ["ip.src", "cf.colo.id"]);
  assert.equal(ratelimit.period, 10);
  assert.equal(ratelimit.requestsPerPeriod, 60);
  assert.equal(ratelimit.mitigationTimeout, 10);
  // Zone-scoped per PR #776: on this zone only the apex serves `/v1/*` (www
  // 301-redirects in http_request_dynamic_redirect, before http_ratelimit),
  // so a bare path match equals the apex match with no config coupling.
  assert.doesNotMatch(String(rule.expression), /http\.host/, "must not match a host");
  assert.match(String(rule.expression), /starts_with\(http\.request\.uri\.path, "\/v1\/"\)/);
});

test("HSTS is on with a deliberate no-preload policy", () => {
  const setting = only(built, ZONE_SETTING);
  assert.equal(setting.inputs.settingId, "security_header");
  assert.equal(setting.inputs.zoneId, "zone");
  const sts = (setting.inputs.value as Record<string, unknown>)
    .strict_transport_security as Record<string, unknown>;
  assert.equal(sts.enabled, true);
  assert.equal(sts.max_age, 15552000);
  assert.equal(sts.include_subdomains, false);
  assert.equal(sts.preload, false);
});

test("production buckets are private and use the stable Wrangler names", () => {
  const buckets = ofType(built, "cloudflare:index/r2Bucket:R2Bucket");
  assert.equal(buckets.length, 3);
  assert.deepEqual(buckets.map((bucket) => bucket.inputs.name), [
    "catalog-media",
    "map-tiles",
    "catalog-snapshots",
  ]);
  assert.equal(buckets.every((bucket) => bucket.inputs.accountId === "acct"), true);
});

test("production declares no R2 custom domain, so all buckets stay private", () => {
  // An R2 bucket is public only when an R2CustomDomain is attached. Asserting
  // none exist across the stack is the privacy invariant: catalog-media,
  // map-tiles, and the new catalog-snapshots bucket are served only through
  // the edge/catalog Workers, never directly.
  const customDomains = ofType(built, "cloudflare:index/r2CustomDomain:R2CustomDomain");
  assert.deepEqual(customDomains, []);
});

test("production mints no Access service token", () => {
  // D3 #1369: only staging goes behind Cloudflare Access. A token minted for a
  // door that does not exist is a live credential sitting in production state
  // with no consumer and nobody rotating it.
  assert.deepEqual(ofType(built, SERVICE_TOKEN), []);
});
