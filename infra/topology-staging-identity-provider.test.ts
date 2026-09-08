/** Which account identity provider the staging door offers, as a specification.
 *
 * The resources are `topology-staging-access.test.ts`; this is the rule that
 * decides what `allowedIdps` may name. Pinned on the exported pure function
 * rather than through repeated `buildStack` calls: `index.ts` builds at import
 * time, so one process can only ever observe one account fixture — the same
 * reason `topology-staging-allowlist.test.ts` exists beside its own program-level
 * file.
 *
 * The stack is built first only so `index.ts` imports against mocks instead of
 * attempting a real engine RPC.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStack } from "./testing/harness.ts";

await buildStack("staging", {
  cloudflareAccountId: "acct",
  cloudflareZoneId: "zone",
  webRoutesEnabled: "true",
  stagingDomain: "staging.animichi.com",
  stagingAccessAllowedEmails: '["owner@example.test"]',
});

const { oneTimePinIdentityProviderId } = await import("./index.ts");

/** An account with one login method of each kind that matters here. */
function makeMixedAccountProviders() {
  return [
    { id: "google-idp", type: "google" },
    { id: "otp-idp", type: "onetimepin" },
    { id: "github-idp", type: "github" },
  ];
}

test("the One-time PIN provider is the one the door offers, whatever its position", () => {
  // Position is the control: the OTP entry is neither first nor last, so code
  // that took `results[0]` — or the last entry — would fail here rather than put
  // an arbitrary login method on staging's front page.
  assert.equal(oneTimePinIdentityProviderId(makeMixedAccountProviders()), "otp-idp");
});

test("an account whose only providers are other login methods is refused", () => {
  // Not "fall back to what is there". Every entry here is a real, usable
  // provider, and offering one would admit whoever that IdP admits.
  assert.throws(
    () => oneTimePinIdentityProviderId([{ id: "google-idp", type: "google" }]),
    /no onetimepin identity provider/,
  );
});

test("an empty account names the dashboard step that fixes it", () => {
  // The message is the whole value of the failure: this is a one-time manual
  // step, and an error that only says "not found" sends the operator to the API.
  assert.throws(
    () => oneTimePinIdentityProviderId([]),
    /create the One-time PIN login method under Zero Trust → Settings → Authentication/,
  );
});

test("an empty account also names the permission that fakes an empty account", () => {
  // How this file's subject got created by mistake: Cloudflare answers a read
  // made without the IdP read permission with `200` and `[]`, never `403`, so a
  // scope-poor token is indistinguishable from an account with no login methods.
  assert.throws(
    () => oneTimePinIdentityProviderId([]),
    /Access: Organizations, Identity Providers, and Groups Read/,
  );
});

test("two One-time PIN providers stop the build rather than one being picked", () => {
  // Cloudflare allows one per account, so this state cannot be reached through
  // the API — but a silent `[0]` here would make a schema or account change into
  // an arbitrary choice of front door, applied without anybody deciding it.
  assert.throws(
    () =>
      oneTimePinIdentityProviderId([
        { id: "first-otp", type: "onetimepin" },
        { id: "second-otp", type: "onetimepin" },
      ]),
    /2 onetimepin providers; Access allows one/,
  );
});
