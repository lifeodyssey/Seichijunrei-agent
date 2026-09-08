/** `webRoutesEnabled` OFF — the default every stack ships with today.
 *
 * This is the assertion that makes the flags meaningful. If `webRoutesEnabled`
 * ever stops gating, DNS records and Worker routes appear on a live zone the
 * next time anyone runs `pulumi up`, with no code change to point at.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack, type Built } from "./testing/harness.ts";

// Only the account id — deliberately none of the domain/zone keys. If the
// program reaches for them while disabled, `config.require` throws and the
// import fails, which is itself the finding.
const built: Built[] = await buildStack("prod", { cloudflareAccountId: "acct" });

test("only private R2 buckets exist when an ungated stack is built", () => {
  const types = built.map((r) => r.type);
  assert.deepEqual(types, [
    "cloudflare:index/r2Bucket:R2Bucket",
    "cloudflare:index/r2Bucket:R2Bucket",
    "cloudflare:index/r2Bucket:R2Bucket",
  ]);
});

test("no R2 custom domain is declared, so every bucket stays private", () => {
  // An R2 bucket is private unless an R2CustomDomain is attached to it. None
  // of the three buckets (catalog-media, map-tiles, catalog-snapshots) may get
  // one, or catalog data would leak without going through the edge Worker.
  const customDomains = built.filter((r) => r.type.includes("cloudflare:index/r2CustomDomain:R2CustomDomain"));
  assert.deepEqual(customDomains, []);
});

test("nothing that could publish the site or harden the zone is declared", () => {
  const publishing = built.filter((r) =>
    /workersCustomDomain|workersRoute|dnsRecord|ruleset|zoneDnssec|zoneSetting/i.test(r.type),
  );
  assert.deepEqual(
    publishing.map((r) => `${r.type} ${r.name}`),
    [],
    "a resource here means the default-off flag no longer gates the cutover, or hardening " +
      "activates without the zoneId config",
  );
});
