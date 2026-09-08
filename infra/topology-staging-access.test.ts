/** The Cloudflare Access door in front of staging (D3 #1369).
 *
 * Separate file because `index.ts` builds at import time and a process can load
 * it once — see `testing/harness.ts` — and because this is the one resource
 * group whose mistakes are invisible: a missing hostname, a missing policy or a
 * renamed output all leave a green apply and a wrong door.
 *
 * The allowlist VALUES the `allow` policy is built from are their own concern
 * and their own file: `topology-staging-allowlist.test.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as pulumi from "@pulumi/pulumi";
import { buildStack, only, ofType, type Built } from "./testing/harness.ts";

const built: Built[] = await buildStack("staging", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  stagingDomain: "staging.animichi.com",
  // Object config reaches the program as the JSON blob Pulumi stores it as.
  stagingAccessAllowedEmails: '["owner@example.test", "second@example.test"]',
});

const SERVICE_TOKEN = "cloudflare:index/zeroTrustAccessServiceToken:ZeroTrustAccessServiceToken";
const APPLICATION = "cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication";
const POLICY = "cloudflare:index/zeroTrustAccessPolicy:ZeroTrustAccessPolicy";
const IDENTITY_PROVIDER =
  "cloudflare:index/zeroTrustAccessIdentityProvider:ZeroTrustAccessIdentityProvider";

function policyNamed(name: string): Built {
  const hit = ofType(built, POLICY).find((policy) => policy.name === name);
  assert.ok(hit, `no Access policy named ${name}; built ${ofType(built, POLICY).map((p) => p.name).join(", ")}`);
  return hit;
}

test("staging mints the one Access service token CI presents at the front door", () => {
  // The Cloudflare-side `name` is what an operator matches in the Zero Trust
  // dashboard when revoking, and the resource name is what Pulumi matches in
  // state — renaming either is a delete-and-recreate that silently invalidates
  // every caller's headers, so both are pinned.
  const token = only(built, SERVICE_TOKEN);
  assert.equal(token.name, "staging-ci");
  assert.equal(token.inputs.name, "animichi-staging-ci");
  assert.equal(token.inputs.accountId, "acct");
  assert.equal(token.inputs.duration, "8760h");
});

test("the application secures the zone hostname AND both workers.dev origins", () => {
  // The load-bearing assertion of this card. #539 is exactly this list going
  // short: a WAF rule could only ever see the zone hostname, so the two origins
  // CD actually smoke-tests answered anybody. Dropping one here leaves a green
  // apply, a green smoke and an open staging.
  const app = only(built, APPLICATION);
  const destinations = app.inputs.destinations as { type: string; uri: string }[];
  assert.deepEqual(destinations.map((destination) => destination.uri), [
    "staging.animichi.com",
    "animichi-staging.zhenjiazhou0127.workers.dev",
    "animichi-web-staging.zhenjiazhou0127.workers.dev",
  ]);
  assert.deepEqual([...new Set(destinations.map((destination) => destination.type))], ["public"]);
});

test("the primary domain is itself one of the destinations, and none is path-scoped", () => {
  // Two measured rules from the N4b live probe (2026-09-08). First, the API
  // refuses an application whose `domain` is absent from `destinations` —
  // `12130 access.api.error.invalid_request: domain not included in
  // destinations` — so breaking this pairing is a failed apply, not a wrong
  // door. Second, a `uri` is path-scoped: a path named in no destination reached
  // the Worker unauthenticated, so a trailing path on any entry here would
  // quietly un-protect the rest of that host.
  const app = only(built, APPLICATION);
  const uris = (app.inputs.destinations as { uri: string }[]).map((d) => d.uri);
  assert.ok(uris.includes(String(app.inputs.domain)), `domain ${app.inputs.domain} not in ${uris.join(", ")}`);
  assert.deepEqual(uris.filter((uri) => uri.includes("/")), []);
});

test("the application is a self-hosted app on the account, primary hostname first", () => {
  const app = only(built, APPLICATION);
  assert.equal(app.name, "staging");
  assert.equal(app.inputs.type, "self_hosted");
  assert.equal(app.inputs.accountId, "acct");
  assert.equal(app.inputs.domain, "staging.animichi.com");
  assert.equal(app.inputs.sessionDuration, "24h");
  assert.equal(app.inputs.appLauncherVisible, false);
});

test("no destination reaches Access through the deprecated selfHostedDomains", () => {
  // `selfHostedDomains` takes the same strings and is what a search finds first,
  // but the provider marks it deprecated with a sunset of 2025-11-21 and states
  // that `destinations`, when present, makes it ignored. A future edit that
  // "simplifies" back to it would cover the primary hostname alone.
  assert.equal(only(built, APPLICATION).inputs.selfHostedDomains, undefined);
});

test("the human half has an identity provider to sign in with", () => {
  // `GET /accounts/{id}/access/identity_providers` answered `[]` on 2026-09-08,
  // and `allowedIdps` defaults to every IdP the account has — none. Without this
  // resource the owner reaches a login page offering nothing to log in with,
  // while the service token keeps working and every automated check stays green.
  const provider = only(built, IDENTITY_PROVIDER);
  assert.equal(provider.name, "staging-onetimepin");
  assert.equal(provider.inputs.type, "onetimepin");
  assert.equal(provider.inputs.name, "One-time PIN");
  assert.equal(provider.inputs.accountId, "acct");
  assert.deepEqual(provider.inputs.config, {});
});

test("the application offers that provider, and only that provider", () => {
  // Named rather than defaulted, so adding a second IdP to the account later is
  // a deliberate edit here instead of a silent widening of who sees a login box.
  assert.deepEqual(only(built, APPLICATION).inputs.allowedIdps, ["staging-onetimepin-id"]);
});

test("automation is admitted by the service token, under Service Auth", () => {
  // `non_identity` is the only decision that answers a service token. Under
  // `allow` the CD smoke probe is redirected to an identity provider and reads
  // the login page as a broken deploy (issue #1369).
  const policy = policyNamed("staging-ci-service-auth");
  assert.equal(policy.inputs.decision, "non_identity");
  assert.equal(policy.inputs.accountId, "acct");
  const includes = policy.inputs.includes as { serviceToken?: { tokenId: string } }[];
  assert.deepEqual(includes.map((rule) => rule.serviceToken?.tokenId), ["staging-ci-id"]);
});

test("the humans in stack config are admitted, one include rule each", () => {
  const policy = policyNamed("staging-owner-sign-in");
  assert.equal(policy.inputs.decision, "allow");
  const includes = policy.inputs.includes as { email?: { email: string } }[];
  assert.deepEqual(includes.map((rule) => rule.email?.email), [
    "owner@example.test",
    "second@example.test",
  ]);
});

test("every decision is spelled the way the Access API accepts, not the way the SDK docs print it", () => {
  // The one assertion the mocks could not make for us. `setMocks` hands back
  // whatever string the program passed, so a decision the API rejects is a
  // green test suite and a failed apply — which is exactly how `nonIdentity`
  // reached `stage-foundation` on the #1369 landing run:
  //
  //   ZeroTrustAccessPolicy 'staging-ci-service-auth' has a problem: Invalid
  //   Attribute Value Match. Attribute decision value must be one of:
  //   ["allow" "deny" "non_identity" "bypass"]
  //
  // `nonIdentity` is not a typo, it is what the installed `.d.ts` documents:
  // the provider schema tags this value with a per-language doc span
  // (`pulumi-lang-nodejs=""nonIdentity""`, `pulumi-lang-hcl=""non_identity""`)
  // and the TypeScript SDK renders the node spelling while sending the string
  // through untouched. So the four literals below are copied from the
  // validator's own message, and both spellings are pinned against them.
  const ACCEPTED = ["allow", "deny", "non_identity", "bypass"];
  const decisions = new Map(ofType(built, POLICY).map((p) => [p.name, String(p.inputs.decision)]));
  assert.equal(decisions.get("staging-ci-service-auth"), "non_identity");
  assert.equal(decisions.get("staging-owner-sign-in"), "allow");
  assert.deepEqual([...decisions].filter(([, d]) => !ACCEPTED.includes(d)), []);
});

test("both policies are attached to the application, Service Auth evaluated first", () => {
  // A policy that exists but is attached to nothing is the quietest failure
  // available here: `pulumi up` is green, the dashboard shows the rule, and the
  // application it was written for still denies everybody.
  const attached = only(built, APPLICATION).inputs.policies as { id: string; precedence: number }[];
  assert.deepEqual(attached, [
    { id: "staging-ci-service-auth-id", precedence: 1 },
    { id: "staging-owner-sign-in-id", precedence: 2 },
  ]);
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
  // This repository is public and an unsealed value comes back in the clear from
  // any operator `pulumi stack export`. The id is the control — if `isSecret`
  // reported everything sealed, the first assertion would pass on any code.
  const program = (await import("./index.ts")) as Record<string, unknown>;
  const secret = program.stagingAccessClientSecret as pulumi.Output<string>;
  const id = program.stagingAccessClientId as pulumi.Output<string>;
  assert.equal(await pulumi.isSecret(secret), true);
  assert.equal(await pulumi.isSecret(id), false);
});
